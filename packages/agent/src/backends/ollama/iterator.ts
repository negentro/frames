import type { AgentEvent } from "../../agent.js";
import { TOOL_DEFINITIONS, executeTool } from "../../tools/index.js";
import {
  chatCompletion,
  extractToolCallsFromText,
  log,
  type ChatMessage,
} from "./shared.js";

const KNOWN_TOOLS = new Set(["Read", "Write", "Edit", "Bash"]);

const ITERATOR_SYSTEM = `You are a frontend developer making targeted changes to an existing React + TypeScript app.

CRITICAL RULES:
- First, read the relevant files to understand the current code.
- Make MINIMAL, targeted changes. Do NOT rewrite entire files.
- Use the Edit tool for small changes (replacing specific strings). Use Write only if most of the file needs to change.
- Tailwind v4: use utility classes. Do NOT import tailwindcss.
- React 19: uses createRoot (already set up in main.tsx). Do NOT touch main.tsx.
- After making changes, run "npm run build" to verify. If it fails, fix the errors.
- When done, run "git add -A" then "git commit -m 'description of change'" as separate commands
- Do NOT run git push or any network commands.`;

export async function* runIterator(
  model: string,
  projectDir: string,
  instruction: string,
  maxTurns: number,
): AsyncGenerator<AgentEvent> {
  const messages: ChatMessage[] = [
    { role: "system", content: ITERATOR_SYSTEM },
    {
      role: "user",
      content: `The user wants the following change:\n\n${instruction}\n\nRead the relevant files first, then make the minimal changes needed.`,
    },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    log(`Iterator turn ${turn + 1}/${maxTurns}`);

    let response;
    try {
      response = await chatCompletion(model, messages, TOOL_DEFINITIONS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", error: msg };
      return;
    }

    const choice = response.choices[0];
    if (!choice) {
      yield { type: "error", error: "No response from Ollama" };
      return;
    }

    const assistantMsg = choice.message;
    const content = assistantMsg.content || "";

    // Check for structured tool calls first, then text-extracted
    let toolCalls;
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      toolCalls = assistantMsg.tool_calls.map((tc) => ({
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments,
      }));
    } else {
      toolCalls = extractToolCallsFromText(content, KNOWN_TOOLS);
    }

    // Emit text if no tool calls (model is done)
    if (toolCalls.length === 0) {
      if (content) {
        log(`Iterator text: ${content.slice(0, 120)}`);
      }
      log("No tool calls, iterator complete");
      break;
    }

    log(`Iterator: ${toolCalls.length} tool call(s)`);
    messages.push({
      role: "assistant",
      content,
      ...(assistantMsg.tool_calls ? { tool_calls: assistantMsg.tool_calls } : {}),
    });

    // Execute tools
    const results: string[] = [];
    for (const tc of toolCalls) {
      const detail =
        (tc.arguments.file_path as string) ||
        (tc.arguments.command as string) ||
        "";
      log(`Iterator tool: ${tc.name} ${detail}`);

      const result = await executeTool(tc.name, tc.arguments, projectDir);
      results.push(`[${tc.name}]: ${result}`);
    }

    // Feed results back
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (let i = 0; i < assistantMsg.tool_calls.length; i++) {
        messages.push({
          role: "tool",
          tool_call_id: assistantMsg.tool_calls[i].id,
          content: results[i] || "Done",
        });
      }
    } else {
      messages.push({
        role: "user",
        content: `Tool results:\n${results.join("\n\n")}`,
      });
    }
  }
}
