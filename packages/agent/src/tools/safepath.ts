import { realpathSync, existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve a file path safely within a project directory.
 * Prevents symlink-based path traversal by checking the real path.
 *
 * Returns the resolved path or an error string.
 */
export function safePath(
  projectDir: string,
  filePath: string,
): { ok: true; resolved: string } | { ok: false; error: string } {
  // Resolve the project dir to its real path first (handles /tmp → /private/tmp on macOS)
  const realProjectDir = realpathSync(projectDir);
  const resolved = resolve(realProjectDir, filePath);

  // Basic prefix check (catches ../ traversal)
  if (!resolved.startsWith(realProjectDir + "/") && resolved !== realProjectDir) {
    return { ok: false, error: `Path "${filePath}" is outside the project directory` };
  }

  // If the file exists, check its real path (follows symlinks)
  if (existsSync(resolved)) {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      return { ok: false, error: `Path "${filePath}" is a symlink — not allowed` };
    }

    const realResolved = realpathSync(resolved);
    if (!realResolved.startsWith(realProjectDir + "/") && realResolved !== realProjectDir) {
      return { ok: false, error: `Path "${filePath}" resolves outside the project directory` };
    }
  }

  // For new files, check that the parent directory is within project
  const parent = resolve(resolved, "..");
  if (existsSync(parent)) {
    const realParent = realpathSync(parent);
    if (!realParent.startsWith(realProjectDir) && realParent !== realProjectDir) {
      return { ok: false, error: `Parent directory of "${filePath}" is outside the project` };
    }
  }

  return { ok: true, resolved };
}
