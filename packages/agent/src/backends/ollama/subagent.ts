import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatCompletion, stripCodeFences, stripThinkTags, extractJSON, log } from "./shared.js";
import type { FilePlan, OrchestratorPlan } from "./orchestrator.js";
import { getSkill } from "../../skills/index.js";

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

export async function runSubagent(
  model: string,
  filePlan: FilePlan,
  projectDir: string,
  writtenFiles: Map<string, string>,
  plan: OrchestratorPlan,
): Promise<{ path: string; content: string }> {
  log(`Subagent: ${filePlan.action} ${filePlan.path} [skill: ${filePlan.skill || "general"}]`);

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

  // For component creation, use the component skill's system prompt if available
  const skill = getSkill(filePlan.skill || "component");
  const systemPrompt = filePlan.action === "create" ? CREATE_SYSTEM : skill.systemPrompt;

  const userPrompt = `${planContext}
File to create: ${filePlan.path}
Description: ${filePlan.description}
${fileContext}
Write the complete content for ${filePlan.path}. Only output the file content, nothing else.`;

  const response = await chatCompletion(model, [
    { role: "system", content: systemPrompt },
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

  // Load the skill persona
  const skill = getSkill(filePlan.skill || "general");
  log(`Using skill: ${skill.name}`);

  const userPrompt = `Current file ${filePlan.path}:
\`\`\`
${currentContent}
\`\`\`

Instruction: ${filePlan.description}

${skill.examples}

Output your edits for this file now.`;

  const response = await chatCompletion(model, [
    { role: "system", content: skill.systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  const raw = stripThinkTags(response.choices[0]?.message?.content || "");
  log(`Modify subagent raw response (${raw.length} chars): ${raw.slice(0, 300)}`);

  // Try to parse as JSON edit operations first
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
    } catch (err) {
      log(`Edit parse error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // If the skill is "component" and no JSON edits, the response might be a full rewrite
  if (filePlan.skill === "component") {
    const content = stripCodeFences(raw);
    if (content.length > 20 && (content.includes("export") || content.includes("function"))) {
      log(`Component skill: accepting full rewrite for ${filePlan.path}`);
      return { path: filePlan.path, content };
    }
  }

  // Fallback: keep file unchanged
  log(`Modify subagent: keeping ${filePlan.path} unchanged (no valid edits)`);
  return { path: filePlan.path, content: currentContent };
}
