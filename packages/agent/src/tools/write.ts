import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safePath } from "./safepath.js";

export async function writeTool(
  args: { file_path: string; content: string },
  projectDir: string,
): Promise<string> {
  const path = safePath(projectDir, args.file_path);
  if (!path.ok) return `Error: ${path.error}`;

  try {
    await mkdir(dirname(path.resolved), { recursive: true });
    await writeFile(path.resolved, args.content, "utf-8");
    return `Wrote ${args.content.length} bytes to ${args.file_path}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error writing file: ${msg}`;
  }
}
