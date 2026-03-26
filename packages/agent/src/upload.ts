import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const API_URL = process.env.API_URL || "http://localhost:8788";
const INTERNAL_API_KEY = process.env.EIGEN_INTERNAL_API_KEY || "eigen-local-dev-key";

interface UploadFile {
  path: string;
  content: string;
  encoding: "base64" | "utf-8";
}

// Text file extensions that can be sent as UTF-8
const TEXT_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".json", ".svg", ".txt", ".map",
]);

async function collectFiles(dir: string, base: string): Promise<UploadFile[]> {
  const files: UploadFile[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, base));
    } else if (entry.isFile()) {
      const relPath = relative(base, fullPath);
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      const isText = TEXT_EXTENSIONS.has(ext);

      const content = await readFile(fullPath, isText ? "utf-8" : "base64");
      files.push({
        path: relPath,
        content,
        encoding: isText ? "utf-8" : "base64",
      });
    }
  }

  return files;
}

export async function uploadBuildToR2(
  projectId: string,
  buildId: string,
  projectDir: string,
): Promise<boolean> {
  const distDir = join(projectDir, "dist");

  try {
    const distStat = await stat(distDir);
    if (!distStat.isDirectory()) {
      console.log("[upload] dist/ is not a directory, skipping upload");
      return false;
    }
  } catch {
    console.log("[upload] dist/ does not exist, skipping upload");
    return false;
  }

  const files = await collectFiles(distDir, distDir);
  if (files.length === 0) {
    console.log("[upload] No files in dist/, skipping upload");
    return false;
  }

  console.log(`[upload] Uploading ${files.length} files to R2 for build ${buildId}`);

  try {
    const res = await fetch(
      `${API_URL}/api/builds/${projectId}/${buildId}/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ files }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.log(`[upload] Upload failed: ${res.status} ${text}`);
      return false;
    }

    const result = await res.json() as { uploaded: number };
    console.log(`[upload] Uploaded ${result.uploaded} files to R2`);
    return true;
  } catch (err) {
    console.log(`[upload] Upload error: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
