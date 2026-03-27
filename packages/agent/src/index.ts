import http from "node:http";
import { mkdir, cp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { generateFromWireframe, iterateOnProject, type AgentEvent } from "./agent.js";
import { uploadBuildToR2 } from "./upload.js";
import { saveProjectToR2, restoreProjectFromR2 } from "./project-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PROJECTS_DIR = process.env.PROJECTS_DIR || "/tmp/eigen-projects";
const TEMPLATES_DIR = join(__dirname, "templates");

async function ensureProjectDir(projectId: string): Promise<string> {
  const projectDir = join(PROJECTS_DIR, projectId);

  if (!existsSync(projectDir)) {
    await mkdir(projectDir, { recursive: true });

    // Copy template files
    const templateFiles = [
      "package.json",
      "vite.config.ts",
      "tsconfig.json",
      "index.html",
      "index.css",
    ];
    for (const file of templateFiles) {
      const dest = file === "index.css" ? join(projectDir, "src", file) : join(projectDir, file);
      await mkdir(join(dest, ".."), { recursive: true });
      await cp(join(TEMPLATES_DIR, file), dest);
    }

    // Initialize git repo
    execSync("git init && git add -A && git commit -m 'Initial project setup'", {
      cwd: projectDir,
      stdio: "pipe",
    });

    // Install dependencies (including devDependencies for build tools)
    execSync("npm install --include=dev", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 120000,
    });
  }

  return projectDir;
}

function writeSSE(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const REQUEST_TIMEOUT_MS = Number(
  process.env.EIGEN_REQUEST_TIMEOUT_MS || "600000", // 10 minutes default
);

async function streamAgentEvents(
  res: http.ServerResponse,
  events: AsyncGenerator<AgentEvent>,
  projectId: string,
  buildId: string,
  projectDir: string,
) {
  let timedOut = false;
  let hadError = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    console.log(`[timeout] Request exceeded ${REQUEST_TIMEOUT_MS}ms limit`);
    writeSSE(res, "error", {
      type: "error",
      error: `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`,
    });
    res.end();
  }, REQUEST_TIMEOUT_MS);

  try {
    for await (const event of events) {
      if (timedOut) break;
      const timestamp = new Date().toISOString().slice(11, 19);
      const preview = event.message || event.error || "";
      console.log(`[${timestamp}] ${event.type}: ${preview}`);
      writeSSE(res, event.type, event);
      if (event.type === "error") hadError = true;
    }

    // Upload build artifacts + project source to R2 after successful completion
    if (!timedOut && !hadError) {
      const uploaded = await uploadBuildToR2(projectId, buildId, projectDir);
      if (!uploaded) {
        writeSSE(res, "error", {
          type: "error",
          error: "Build completed but upload failed — dist/ may be missing or empty",
        });
      }
      await saveProjectToR2(projectId, projectDir);
    }
  } finally {
    clearTimeout(timeout);
    if (!timedOut) {
      res.end();
    }
  }
}

function parseBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error(`Request body exceeds ${Math.round(maxBytes / 1024)}KB limit`));
        return;
      }
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers — restrict to local frontend only
  const allowedOrigins = ["http://localhost:5173", "http://localhost:5174", "http://localhost:8788"];
  const origin = req.headers.origin || "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const isGenerate = req.method === "POST" && req.url === "/generate";
    const maxBody = isGenerate ? 8 * 1024 * 1024 : 64 * 1024; // 8MB for generate (has image), 64KB for everything else
    const body = await parseBody(req, maxBody);

    if (isGenerate) {
      const { projectId, buildId, image } = JSON.parse(body);
      console.log(`\n=== GENERATE projectId=${projectId} ===`);

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      writeSSE(res, "status", { type: "status", message: "Setting up project" });

      const projectDir = await ensureProjectDir(projectId);

      writeSSE(res, "status", { type: "status", message: "Dependencies installed" });

      const events = generateFromWireframe(projectDir, image);
      await streamAgentEvents(res, events, projectId, buildId, projectDir);
      return;
    }

    if (req.method === "POST" && req.url === "/iterate") {
      const { projectId, buildId, instruction, annotation } = JSON.parse(body);
      console.log(`\n=== ITERATE projectId=${projectId} ===`);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const projectDir = join(PROJECTS_DIR, projectId);
      if (!existsSync(join(projectDir, "src"))) {
        writeSSE(res, "status", { type: "status", message: "Restoring project" });
        const restored = await restoreProjectFromR2(projectId, projectDir);
        if (!restored) {
          writeSSE(res, "error", { type: "error", error: "Project not found" });
          res.end();
          return;
        }
      }

      writeSSE(res, "status", { type: "status", message: "Starting iteration" });

      const events = iterateOnProject(projectDir, instruction, annotation);
      await streamAgentEvents(res, events, projectId, buildId, projectDir);
      return;
    }

    // Undo last change — revert to previous commit, rebuild, upload
    if (req.method === "POST" && req.url === "/undo") {
      const { projectId, buildId } = JSON.parse(body);
      console.log(`\n=== UNDO projectId=${projectId} ===`);

      const projectDir = join(PROJECTS_DIR, projectId);
      if (!existsSync(join(projectDir, "src"))) {
        const restored = await restoreProjectFromR2(projectId, projectDir);
        if (!restored) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Project not found" }));
          return;
        }
      }

      try {
        // Check we have more than one commit (initial + at least one iteration)
        const commitCount = execSync("git rev-list --count HEAD", {
          cwd: projectDir,
          encoding: "utf-8",
        }).trim();

        if (parseInt(commitCount) <= 2) {
          // 1 = initial setup, 2 = initial generation — don't undo these
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Cannot undo initial generation" }));
          return;
        }

        // Reset to previous commit
        execSync("git reset --hard HEAD~1", { cwd: projectDir, stdio: "pipe" });

        // Rebuild
        execSync("npm run build", { cwd: projectDir, stdio: "pipe", timeout: 60000 });

        // Upload new build + save reverted source to R2
        await uploadBuildToR2(projectId, buildId, projectDir);
        await saveProjectToR2(projectId, projectDir);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Undo failed";
        console.error(`Undo error: ${msg}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    // Serve build artifacts: GET /builds/:projectId/*
    if (req.method === "GET" && req.url?.startsWith("/builds/")) {
      const pathParts = req.url.slice("/builds/".length);
      const slashIdx = pathParts.indexOf("/");
      const projectId = slashIdx === -1 ? pathParts : pathParts.slice(0, slashIdx);
      const filePath = slashIdx === -1 ? "index.html" : pathParts.slice(slashIdx + 1) || "index.html";

      const fullPath = join(PROJECTS_DIR, projectId, "dist", filePath);
      if (!existsSync(fullPath)) {
        // SPA fallback
        const fallbackPath = join(PROJECTS_DIR, projectId, "dist", "index.html");
        if (existsSync(fallbackPath)) {
          const content = await readFile(fallbackPath);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(content);
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
        return;
      }

      const content = await readFile(fullPath);
      const ext = fullPath.slice(fullPath.lastIndexOf("."));
      const mimeTypes: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      res.end(content);
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Server error:", message);

    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    } else {
      writeSSE(res, "error", { type: "error", error: message });
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Agent server listening on http://localhost:${PORT}`);
  console.log(`Projects directory: ${PROJECTS_DIR}`);
});
