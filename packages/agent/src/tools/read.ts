import { readFile } from "node:fs/promises";
import { safePath } from "./safepath.js";

export async function readTool(
  args: { file_path: string },
  projectDir: string,
): Promise<string> {
  const path = safePath(projectDir, args.file_path);
  if (!path.ok) return `Error: ${path.error}`;

  try {
    const content = await readFile(path.resolved, "utf-8");
    if (content.length > 4000) {
      return content.slice(0, 4000) + "\n...(truncated)";
    }
    return content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error reading file: ${msg}`;
  }
}
