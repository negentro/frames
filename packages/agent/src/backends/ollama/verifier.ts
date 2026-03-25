import type { AgentEvent } from "../../agent.js";
import { executeTool } from "../../tools/index.js";
import { bashTool } from "../../tools/bash.js";
import {
  chatCompletion,
  extractToolCallsFromText,
  log,
  type ChatMessage,
} from "./shared.js";

const KNOWN_FIX_TOOLS = new Set(["Read", "Write", "Edit", "Bash"]);

const FIX_SYSTEM = `You are a build error fixer. You MUST use tools to fix errors. Do NOT explain — just call tools.

Available tools: Read, Write, Edit, Bash

Steps:
1. Read the file mentioned in the error
2. Use Edit or Write to fix it
3. Run "npm run build" with Bash to verify

Call tools using this JSON format in your response:
{"name": "Read", "arguments": {"file_path": "src/App.tsx"}}
{"name": "Edit", "arguments": {"file_path": "src/App.tsx", "old_string": "broken code", "new_string": "fixed code"}}
{"name": "Bash", "arguments": {"command": "npm run build"}}

Rules:
- React 19: do NOT import React. Use createRoot from "react-dom/client".
- Tailwind v4: do NOT import tailwindcss. Use utility classes only.
- Make minimal changes.`;

const MAX_FIX_TURNS = 5;

export interface VerifyResult {
  success: boolean;
  error: string;
  events: AgentEvent[];
}

export async function runVerifier(
  model: string,
  projectDir: string,
): Promise<VerifyResult> {
  const events: AgentEvent[] = [];

  const buildOutput = bashTool({ command: "npm run build" }, projectDir);
  const buildFailed =
    buildOutput.includes("Exit code:") || buildOutput.includes("error TS");

  if (!buildFailed) {
    log("Build succeeded");
    return { success: true, error: "", events };
  }

  log("Build failed, attempting fix");
  events.push({ type: "status", message: "Build failed, fixing errors" });

  // Run fix agent
  const messages: ChatMessage[] = [
    { role: "system", content: FIX_SYSTEM },
    {
      role: "user",
      content: `The build failed with this output:\n\n${buildOutput}\n\nPlease fix the errors.`,
    },
  ];

  for (let turn = 0; turn < MAX_FIX_TURNS; turn++) {
    const response = await chatCompletion(model, messages);
    const content = response.choices[0]?.message?.content || "";
    const toolCalls = extractToolCallsFromText(content, KNOWN_FIX_TOOLS);

    if (toolCalls.length === 0) {
      log("Fix agent stopped without tool calls");
      break;
    }

    messages.push({ role: "assistant", content });

    const results: string[] = [];
    for (const tc of toolCalls) {
      const detail =
        (tc.arguments.file_path as string) ||
        (tc.arguments.command as string) ||
        "";
      log(`Fix tool: ${tc.name} ${detail}`);
      const result = await executeTool(tc.name, tc.arguments, projectDir);
      results.push(`[${tc.name}]: ${result}`);
    }

    messages.push({
      role: "user",
      content: `Tool results:\n${results.join("\n\n")}`,
    });
  }

  // Check if fix worked
  const retryOutput = bashTool({ command: "npm run build" }, projectDir);
  const retryFailed =
    retryOutput.includes("Exit code:") || retryOutput.includes("error TS");

  if (!retryFailed) {
    log("Build succeeded after fix");
    return { success: true, error: "", events };
  }

  log("Build still failing after fix attempt");
  return { success: false, error: retryOutput, events };
}
