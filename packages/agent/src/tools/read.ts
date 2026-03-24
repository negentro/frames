import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readTool(
  args: { file_path: string },
  projectDir: string,
): Promise<string> {
  const resolved = resolve(projectDir, args.file_path);
  if (!resolved.startsWith(projectDir)) {
    return `Error: path "${args.file_path}" is outside the project directory`;
  }
  try {
    const content = await readFile(resolved, "utf-8");
    if (content.length > 4000) {
      return content.slice(0, 4000) + "\n...(truncated)";
    }
    return content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error reading file: ${msg}`;
  }
}
