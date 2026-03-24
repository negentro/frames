import { execSync } from "node:child_process";

const MAX_OUTPUT_CHARS = 2000;

const BLOCKED_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+remote\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bnpx?\s+publish\b/,
];

export function bashTool(
  args: { command: string },
  projectDir: string,
): string {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(args.command)) {
      return `Error: command blocked — network operations are not allowed`;
    }
  }

  try {
    const output = execSync(args.command, {
      cwd: projectDir,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (output.length > MAX_OUTPUT_CHARS) {
      return output.slice(0, MAX_OUTPUT_CHARS) + "\n...(truncated)";
    }
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; status?: number };
    const stderr = e.stderr || "";
    const stdout = e.stdout || "";
    const combined = `Exit code: ${e.status ?? 1}\nstdout: ${stdout}\nstderr: ${stderr}`;
    if (combined.length > MAX_OUTPUT_CHARS) {
      return combined.slice(0, MAX_OUTPUT_CHARS) + "\n...(truncated)";
    }
    return combined;
  }
}
