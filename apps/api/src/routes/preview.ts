import { Hono } from "hono";
import type { App } from "../types";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

const preview = new Hono<App>();

// Serve built assets — proxies to agent server in dev, R2 in production
preview.get("/:projectId/builds/:buildId/*", async (c) => {
  const { projectId, buildId } = c.req.param();
  const path = c.req.path.split(`/builds/${buildId}/`)[1] || "index.html";

  // Try R2 first (production)
  try {
    const r2Key = `projects/${projectId}/builds/${buildId}/${path}`;
    const object = await c.env.ASSETS.get(r2Key);

    if (object) {
      return new Response(object.body, {
        headers: {
          "Content-Type": getMimeType(path),
          "Cache-Control": path.includes("assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      });
    }
  } catch {
    // R2 not available, fall through to agent proxy
  }

  // Proxy to agent server (local dev)
  try {
    const agentUrl = `${c.env.AGENT_URL}/builds/${projectId}/${path}`;
    const agentRes = await fetch(agentUrl);

    if (agentRes.ok) {
      return new Response(agentRes.body, {
        headers: {
          "Content-Type": agentRes.headers.get("Content-Type") || getMimeType(path),
          "Cache-Control": "no-cache",
        },
      });
    }
  } catch {
    // Agent not reachable
  }

  return c.json({ error: "Not found" }, 404);
});

export { preview };
