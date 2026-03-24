import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function editTool(
  args: { file_path: string; old_string: string; new_string: string },
  projectDir: string,
): Promise<string> {
  const resolved = resolve(projectDir, args.file_path);
  if (!resolved.startsWith(projectDir)) {
    return `Error: path "${args.file_path}" is outside the project directory`;
  }
  try {
    const content = await readFile(resolved, "utf-8");
    if (!content.includes(args.old_string)) {
      return `Error: old_string not found in ${args.file_path}`;
    }
    const updated = content.replace(args.old_string, args.new_string);
    await writeFile(resolved, updated, "utf-8");
    return `Edited ${args.file_path}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error editing file: ${msg}`;
  }
}
