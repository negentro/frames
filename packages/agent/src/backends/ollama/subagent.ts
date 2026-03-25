import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatCompletion, stripCodeFences, log } from "./shared.js";
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

const MODIFY_SYSTEM = `You are a code editor. You will receive an existing file and an instruction describing what to change.

CRITICAL RULES:
- Output ONLY the complete modified file content. No markdown fences, no explanation.
- The instruction describes a CODE CHANGE to make, NOT content to display on screen.
- Preserve the existing structure and imports. Only change what the instruction asks for.
- Do NOT remove existing components or imports unless the instruction explicitly asks for removal.
- Do NOT replace working code with placeholder text.
- Make the MINIMAL change necessary to fulfill the instruction.
- If the instruction mentions a visual/layout issue, fix it by changing CSS classes or component structure.`;

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
    // If file doesn't exist, fall back to create behavior
    log(`Cannot read ${filePlan.path} for modify, treating as create`);
    currentContent = "";
  }

  if (!currentContent) {
    // Can't modify what doesn't exist — generate from scratch
    const response = await chatCompletion(model, [
      { role: "system", content: CREATE_SYSTEM },
      { role: "user", content: `File: ${filePlan.path}\nDescription: ${filePlan.description}\n\nWrite the complete content.` },
    ]);
    const raw = response.choices[0]?.message?.content || "";
    return { path: filePlan.path, content: stripCodeFences(raw) };
  }

  const userPrompt = `Here is the current content of ${filePlan.path}:

\`\`\`
${currentContent}
\`\`\`

Instruction: ${filePlan.description}

Apply this change to the file. Output the COMPLETE modified file. Preserve all existing code that is not related to the change.`;

  const response = await chatCompletion(model, [
    { role: "system", content: MODIFY_SYSTEM },
    { role: "user", content: userPrompt },
  ]);

  const raw = response.choices[0]?.message?.content || "";
  const content = stripCodeFences(raw);
  log(`Modify subagent produced ${content.length} chars for ${filePlan.path}`);
  return { path: filePlan.path, content };
}
