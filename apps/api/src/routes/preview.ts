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

// Serve built assets from R2 for iframe preview
preview.get("/:projectId/builds/:buildId/*", async (c) => {
  const { projectId, buildId } = c.req.param();
  const path = c.req.path.split(`/builds/${buildId}/`)[1] || "index.html";
  const r2Key = `projects/${projectId}/builds/${buildId}/${path}`;

  const object = await c.env.ASSETS.get(r2Key);

  if (!object) {
    // Fall back to index.html for SPA routing
    const fallbackKey = `projects/${projectId}/builds/${buildId}/index.html`;
    const fallback = await c.env.ASSETS.get(fallbackKey);

    if (!fallback) {
      return c.json({ error: "Not found" }, 404);
    }

    return new Response(fallback.body, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache",
      },
    });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": getMimeType(path),
      "Cache-Control": path.includes("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
});

export { preview };
