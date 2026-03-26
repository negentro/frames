import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

const API_URL = process.env.API_URL || "http://localhost:8788";
const INTERNAL_API_KEY =
  process.env.EIGEN_INTERNAL_API_KEY || "eigen-local-dev-key";

/**
 * Zip the project's git repo and upload to R2 via the API server.
 * Called after successful builds so the project can be restored later.
 */
export async function saveProjectToR2(
  projectId: string,
  projectDir: string,
): Promise<boolean> {
  try {
    const zipPath = join(projectDir, "source.zip");

    // Zip the entire project (including .git, node_modules excluded)
    execSync(
      'zip -r source.zip . -x "node_modules/*" "dist/*" ".git/objects/pack/*"',
      { cwd: projectDir, stdio: "pipe", timeout: 30000 },
    );

    const zipData = await readFile(zipPath);
    const base64 = zipData.toString("base64");

    const res = await fetch(
      `${API_URL}/api/builds/${projectId}/source/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ content: base64 }),
      },
    );

    // Clean up local zip
    await rm(zipPath, { force: true });

    if (!res.ok) {
      console.log(`[project-store] Upload failed: ${res.status}`);
      return false;
    }

    console.log(`[project-store] Saved project ${projectId} to R2`);
    return true;
  } catch (err) {
    console.log(
      `[project-store] Save error: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

/**
 * Restore a project from R2 if it doesn't exist locally.
 * Downloads the zip and extracts it to the project directory.
 */
export async function restoreProjectFromR2(
  projectId: string,
  projectDir: string,
): Promise<boolean> {
  if (existsSync(join(projectDir, "src"))) {
    // Project already exists locally
    return true;
  }

  try {
    console.log(
      `[project-store] Restoring project ${projectId} from R2...`,
    );

    const res = await fetch(
      `${API_URL}/api/builds/${projectId}/source/download`,
      {
        headers: {
          Authorization: `Bearer ${INTERNAL_API_KEY}`,
        },
      },
    );

    if (!res.ok) {
      console.log(`[project-store] Download failed: ${res.status}`);
      return false;
    }

    const { content } = (await res.json()) as { content: string };
    if (!content) {
      console.log(`[project-store] No content in response`);
      return false;
    }

    // Create project dir and extract zip
    await mkdir(projectDir, { recursive: true });
    const zipPath = join(projectDir, "source.zip");
    await writeFile(zipPath, Buffer.from(content, "base64"));

    execSync("unzip -o source.zip", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 30000,
    });

    await rm(zipPath, { force: true });

    // Reinstall dependencies if node_modules is missing
    if (!existsSync(join(projectDir, "node_modules"))) {
      console.log(`[project-store] Installing dependencies...`);
      execSync("npm install", {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 120000,
      });
    }

    console.log(`[project-store] Restored project ${projectId}`);
    return true;
  } catch (err) {
    console.log(
      `[project-store] Restore error: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}
