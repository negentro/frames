import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CommandRule {
  allowed_subcommands?: string[];
}

interface BashPermissions {
  commands: Record<string, CommandRule>;
  security: {
    allow_subshells: boolean;
    allow_process_substitution: boolean;
    strip_env: string[];
    max_output_chars: number;
    timeout_ms: number;
  };
}

// Load permissions config
function loadPermissions(): BashPermissions {
  const configPath = join(__dirname, "../../bash-permissions.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // Strict fallback — allow nothing
    return {
      commands: {},
      security: {
        allow_subshells: false,
        allow_process_substitution: false,
        strip_env: [],
        max_output_chars: 2000,
        timeout_ms: 60000,
      },
    };
  }
}

const permissions = loadPermissions();

// Strip quoted regions to get only the "shell-interpreted" parts of a command
function stripQuoted(command: string): string {
  let result = "";
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'" ) {
      // Single quote: skip until closing single quote (no escaping inside)
      const end = command.indexOf("'", i + 1);
      i = end === -1 ? command.length : end + 1;
    } else if (ch === '"') {
      // Double quote: skip until unescaped closing double quote
      i++;
      while (i < command.length) {
        if (command[i] === "\\" && i + 1 < command.length) {
          i += 2; // skip escaped char
        } else if (command[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (ch === "\\" && i + 1 < command.length) {
      i += 2; // skip escaped char outside quotes
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

function validateCommand(command: string): string | null {
  const { security, commands } = permissions;

  const unquoted = stripQuoted(command);

  // Block command chaining — each tool call should be a single command
  if (/[;&|]/.test(unquoted)) {
    return "Command chaining (&&, ||, ;, |) is not allowed. Use separate tool calls.";
  }

  // Block subshells
  if (!security.allow_subshells) {
    if (/`/.test(unquoted) || /\$\(/.test(unquoted)) {
      return "Subshell expansions ($() and backticks) are not allowed";
    }
  }

  // Block process substitution
  if (!security.allow_process_substitution) {
    if (/<\(/.test(unquoted) || />\(/.test(unquoted)) {
      return "Process substitution is not allowed";
    }
  }

  // Block redirections to prevent writing to arbitrary files
  if (/[<>]/.test(unquoted.replace(/2>&1/g, ""))) {
    return "File redirections (>, <, >>) are not allowed";
  }

  // Validate the single command
  const stripped = command.replace(/^(\w+=\S+\s+)*/, "").trim();
  const parts = stripped.split(/\s+/);
  const base = parts[0] || "";
  const sub = parts[1] || "";

  const rule = commands[base];
  if (!rule) {
    return `Command "${base}" is not allowed. Permitted: ${Object.keys(commands).join(", ")}`;
  }

  if (rule.allowed_subcommands) {
    if (sub && !rule.allowed_subcommands.includes(sub)) {
      return `"${base} ${sub}" is not allowed. Permitted: ${base} ${rule.allowed_subcommands.join(", ")}`;
    }
  }

  return null;
}

export function bashTool(
  args: { command: string },
  projectDir: string,
): string {
  const error = validateCommand(args.command);
  if (error) {
    return `Error: command blocked — ${error}`;
  }

  const { security } = permissions;

  // Build env with sensitive vars stripped
  const env = { ...process.env };
  for (const key of security.strip_env) {
    delete env[key];
  }

  try {
    const output = execSync(args.command, {
      cwd: projectDir,
      timeout: security.timeout_ms,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    if (output.length > security.max_output_chars) {
      return output.slice(0, security.max_output_chars) + "\n...(truncated)";
    }
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; status?: number };
    const stderr = e.stderr || "";
    const stdout = e.stdout || "";
    const combined = `Exit code: ${e.status ?? 1}\nstdout: ${stdout}\nstderr: ${stderr}`;
    if (combined.length > security.max_output_chars) {
      return combined.slice(0, security.max_output_chars) + "\n...(truncated)";
    }
    return combined;
  }
}
