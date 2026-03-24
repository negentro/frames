import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export async function writeTool(
  args: { file_path: string; content: string },
  projectDir: string,
): Promise<string> {
  const resolved = resolve(projectDir, args.file_path);
  if (!resolved.startsWith(projectDir)) {
    return `Error: path "${args.file_path}" is outside the project directory`;
  }
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, args.content, "utf-8");
    return `Wrote ${args.content.length} bytes to ${args.file_path}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error writing file: ${msg}`;
  }
}
