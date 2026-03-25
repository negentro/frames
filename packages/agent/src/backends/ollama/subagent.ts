import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatCompletion, stripCodeFences, stripThinkTags, extractJSON, log } from "./shared.js";
import type { FilePlan, OrchestratorPlan } from "./orchestrator.js";

const CREATE_SYSTEM = `You are a code generator. Write the complete content for a single file.

Rules:
- Output ONLY the file content. No markdown fences, no explanation, no preamble.
- React 19: use function components with default exports. Do NOT import React.
- Never use ReactDOM.render(). The entry point (main.tsx) is handled separately.
- Tailwind v4: use utility classes directly. Do NOT import tailwindcss anywhere.
- Do NOT import "./index.css" — only main.tsx does that.
- Available libraries: react 19, react-dom 19, tailwindcss v4 (utility classes), lucide-react, clsx.
- TypeScript with .tsx extension for components.
- Use default exports for all components.
- Only import files that exist in the project plan. Do NOT import files that are not listed.
- Be concise. Write minimal code that works.`;

const MODIFY_SYSTEM = `You output JSON edit operations to modify a file. You receive the current file content and an instruction.

Output a JSON array of edits. Each edit replaces an exact string match:
[
  {"old": "exact string to find", "new": "replacement string"}
]

Rules:
- The "old" value MUST be an exact substring from the current file.
- Make the MINIMUM edits needed. Do not rewrite unrelated code.
- Output ONLY the JSON array. No explanation.

Example — to change a div's color from blue to red:
[{"old": "bg-blue-500", "new": "bg-red-500"}]

Example — to add a className:
[{"old": "className=\\"flex\\"", "new": "className=\\"flex text-red-500\\""}]`;

export async function runSubagent(
  model: string,
  filePlan: FilePlan,
  projectDir: string,
  writtenFiles: Map<string, string>,
  plan: OrchestratorPlan,
): Promise<{ path: string; content: string }> {
  log(`Subagent: ${filePlan.action} ${filePlan.path}`);

  if (filePlan.action === "modify") {
    return runModifySubagent(model, filePlan, projectDir);
  }
  return runCreateSubagent(model, filePlan, projectDir, writtenFiles, plan);
}

async function runCreateSubagent(
  model: string,
  filePlan: FilePlan,
  projectDir: string,
  writtenFiles: Map<string, string>,
  plan: OrchestratorPlan,
): Promise<{ path: string; content: string }> {
  const planContext =
    "Full project plan (these are ALL the files that will exist):\n" +
    plan.files
      .map((f) => `- ${f.path}: ${f.description}`)
      .join("\n") +
    "\n- src/main.tsx: Entry point (pre-generated, imports App from ./App)\n" +
    "- src/index.css: Tailwind styles (pre-generated)\n";

  let fileContext = "";
  for (const [path, content] of writtenFiles) {
    if (path !== filePlan.path && path !== "src/main.tsx" && content.length < 3000) {
      fileContext += `\nContent of ${path}:\n\`\`\`\n${content}\n\`\`\`\n`;
    }
  }

  const userPrompt = `${planContext}
File to create: ${filePlan.path}
Description: ${filePlan.description}
${fileContext}
Write the complete content for ${filePlan.path}. Only output the file content, nothing else.`;

  const response = await chatCompletion(model, [
    { role: "system", content: CREATE_SYSTEM },
    { role: "user", content: userPrompt },
  ]);

  const raw = response.choices[0]?.message?.content || "";
  const content = stripCodeFences(raw);
  log(`Create subagent produced ${content.length} chars for ${filePlan.path}`);
  return { path: filePlan.path, content };
}

async function runModifySubagent(
  model: string,
  filePlan: FilePlan,
  projectDir: string,
): Promise<{ path: string; content: string }> {
  let currentContent = "";
  try {
    const fullPath = resolve(projectDir, filePlan.path);
    currentContent = await readFile(fullPath, "utf-8");
  } catch {
    log(`Cannot read ${filePlan.path} for modify, treating as create`);
  }

  if (!currentContent) {
    const response = await chatCompletion(model, [
      { role: "system", content: CREATE_SYSTEM },
      { role: "user", content: `File: ${filePlan.path}\nDescription: ${filePlan.description}\n\nWrite the complete content.` },
    ]);
    const raw = response.choices[0]?.message?.content || "";
    return { path: filePlan.path, content: stripCodeFences(raw) };
  }

  const userPrompt = `Current file ${filePlan.path}:
\`\`\`
${currentContent}
\`\`\`

Instruction: ${filePlan.description}

Output a JSON array of edits to apply.`;

  const response = await chatCompletion(model, [
    { role: "system", content: MODIFY_SYSTEM },
    { role: "user", content: userPrompt },
  ]);

  const raw = stripThinkTags(response.choices[0]?.message?.content || "");
  log(`Modify subagent raw response: ${raw.slice(0, 300)}`);

  // Parse edit operations
  const jsonStr = extractJSON(raw);
  if (jsonStr) {
    try {
      const edits = JSON.parse(jsonStr) as Array<{ old: string; new: string }>;
      let modified = currentContent;
      let appliedCount = 0;
      for (const edit of edits) {
        if (modified.includes(edit.old)) {
          modified = modified.replace(edit.old, edit.new);
          appliedCount++;
          log(`Edit applied: "${edit.old.slice(0, 50)}" → "${edit.new.slice(0, 50)}"`);
        } else {
          log(`Edit skipped (not found): "${edit.old.slice(0, 50)}"`);
        }
      }
      if (appliedCount > 0) {
        log(`Modify subagent: ${appliedCount}/${edits.length} edits applied for ${filePlan.path}`);
        return { path: filePlan.path, content: modified };
      }
      log(`No edits applied, falling back to full rewrite`);
    } catch (err) {
      log(`Edit parse error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fallback: if edit parsing fails, return current content unchanged
  log(`Modify subagent: keeping ${filePlan.path} unchanged (edit parsing failed)`);
  return { path: filePlan.path, content: currentContent };
}
