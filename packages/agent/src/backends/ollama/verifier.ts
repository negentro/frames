import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { AgentEvent } from "../../agent.js";
import { executeTool } from "../../tools/index.js";
import { bashTool } from "../../tools/bash.js";
import {
  chatCompletion,
  extractToolCallsFromText,
  log,
  type ChatMessage,
} from "./shared.js";

/** Run `npm run build` with a larger output buffer than bashTool's 2000 char limit. */
function runBuild(projectDir: string): string {
  try {
    const output = execSync("npm run build", {
      cwd: projectDir,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Cap at 8000 chars — enough for the fixer to see meaningful errors
    if (output.length > 8000) {
      return output.slice(0, 8000) + "\n...(truncated)";
    }
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; status?: number };
    const stderr = e.stderr || "";
    const stdout = e.stdout || "";
    const combined = `Exit code: ${e.status ?? 1}\nstdout: ${stdout}\nstderr: ${stderr}`;
    if (combined.length > 8000) {
      return combined.slice(0, 8000) + "\n...(truncated)";
    }
    return combined;
  }
}

const KNOWN_FIX_TOOLS = new Set(["Read", "Write", "Edit", "Bash"]);

const FIX_SYSTEM = `You are a build error fixer. You MUST use tools to fix errors. Do NOT explain — just call tools.

Available tools: Read, Write, Edit, Bash

IMPORTANT: You must Read AND fix in the SAME turn. Do not spend a turn only reading — always include an Edit or Write alongside your Read.

Call tools using this JSON format in your response (multiple tool calls per turn are OK):
{"name": "Read", "arguments": {"file_path": "src/App.tsx"}}
{"name": "Edit", "arguments": {"file_path": "src/App.tsx", "old_string": "broken code", "new_string": "fixed code"}}
{"name": "Write", "arguments": {"file_path": "src/App.tsx", "content": "complete file content"}}
{"name": "Bash", "arguments": {"command": "npm run build"}}

Rules:
- Components live under src/components/. Check the FILE LISTING below for exact paths.
- React 19: do NOT import React. Use createRoot from "react-dom/client".
- Tailwind v4: do NOT import tailwindcss. Use utility classes only.
- Do NOT modify tsconfig.json, package.json, vite.config.ts, or index.html. Only fix files under src/.
- Use relative paths (e.g. "src/App.tsx", "src/components/Header.tsx"), not absolute paths.
- Make minimal changes. Fix the ROOT CAUSE, not just the symptom.
- The ONLY Bash command you may run is "npm run build". Do NOT run npm install, npx tsc, or any other command.

Common error patterns:
- "Cannot find module './Foo'": The import path is wrong. Components are in src/components/.
- "has no default export": Change to { Name } import syntax, or add a default export.
- "'React' refers to a UMD global": Remove the "import React" line entirely.
- "Property does not exist on type": Use optional chaining (?.) or fix the type.`;

const MAX_FIX_TURNS = 6;

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

  const buildOutput = runBuild(projectDir);
  const hasErrors =
    buildOutput.includes("Exit code:") || buildOutput.includes("error TS");
  const hasDistIndex = existsSync(join(projectDir, "dist", "index.html"));

  if (!hasErrors && hasDistIndex) {
    log("Build succeeded (dist/index.html present)");
    return { success: true, error: "", events };
  }

  // Build produced no output — treat as failure even if exit code was 0
  if (!hasErrors && !hasDistIndex) {
    log("Build exited cleanly but dist/index.html missing");
  }

  log("Build failed, attempting fix");
  events.push({ type: "status", message: "Build failed, fixing errors" });

  // Gather file listing so fixer knows exact paths
  let fileListing = "";
  try {
    fileListing = execSync("find src -type f -name '*.tsx' -o -name '*.ts' | sort", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch { /* ignore */ }

  // Run fix agent
  const messages: ChatMessage[] = [
    { role: "system", content: FIX_SYSTEM },
    {
      role: "user",
      content: `The build failed with this output:\n\n${buildOutput}\n\nProject files:\n${fileListing}\n\nPlease fix the errors.`,
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
      // Only allow "npm run build" as a Bash command
      if (tc.name === "Bash" && tc.arguments.command !== "npm run build") {
        log(`Fix tool: BLOCKED ${tc.name} ${tc.arguments.command}`);
        results.push(`[${tc.name}]: Only "npm run build" is allowed.`);
        continue;
      }
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
  const retryOutput = runBuild(projectDir);
  const retryHasErrors =
    retryOutput.includes("Exit code:") || retryOutput.includes("error TS");
  const retryHasDist = existsSync(join(projectDir, "dist", "index.html"));

  if (!retryHasErrors && retryHasDist) {
    log("Build succeeded after fix (dist/index.html present)");
    return { success: true, error: "", events };
  }

  const failReason = retryHasErrors
    ? retryOutput
    : "Build exited cleanly but dist/index.html is missing — check vite config and src/main.tsx";
  log("Build still failing after fix attempt");
  return { success: false, error: failReason, events };
}
