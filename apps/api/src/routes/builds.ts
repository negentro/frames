import { Hono } from "hono";
import type { App } from "../types";

const builds = new Hono<App>();

// Upload build artifacts to R2 — called by agent server after successful build
// Expects multipart form data with files, authenticated via internal API key
builds.post("/:projectId/:buildId/upload", async (c) => {
  const authHeader = c.req.header("Authorization");
  const expectedKey = c.env.INTERNAL_API_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { projectId, buildId } = c.req.param();
  const body = await c.req.json<{
    files: Array<{ path: string; content: string; encoding?: string }>;
  }>();

  if (!body.files || !Array.isArray(body.files)) {
    return c.json({ error: "Missing files array" }, 400);
  }

  if (body.files.length > 100) {
    return c.json({ error: "Too many files (max 100)" }, 400);
  }

  for (const file of body.files) {
    if (!file.path || typeof file.path !== "string" || file.path.length > 500) {
      return c.json({ error: "Invalid file path" }, 400);
    }
    if (file.path.includes("..")) {
      return c.json({ error: "Path traversal not allowed" }, 400);
    }
    if (!file.content || typeof file.content !== "string" || file.content.length > 2 * 1024 * 1024) {
      return c.json({ error: `File ${file.path} content too large (max 2MB per file)` }, 400);
    }
  }

  const r2Prefix = `projects/${projectId}/builds/${buildId}/`;
  let uploaded = 0;

  for (const file of body.files) {
    const key = `${r2Prefix}${file.path}`;
    const data =
      file.encoding === "base64"
        ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(file.content);

    await c.env.ASSETS.put(key, data);
    uploaded++;
  }

  return c.json({ ok: true, uploaded, r2Prefix });
});

// Upload project source zip to R2 — called by agent server after builds
builds.post("/:projectId/source/upload", async (c) => {
  const authHeader = c.req.header("Authorization");
  const expectedKey = c.env.INTERNAL_API_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { projectId } = c.req.param();
  const body = await c.req.json<{ content: string }>();

  if (!body.content || typeof body.content !== "string") {
    return c.json({ error: "Missing content" }, 400);
  }

  if (body.content.length > 50 * 1024 * 1024) {
    return c.json({ error: "Source zip too large (max 50MB)" }, 400);
  }

  const data = Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0));
  await c.env.ASSETS.put(`projects/${projectId}/source.zip`, data);

  return c.json({ ok: true });
});

// Download project source zip from R2 — called by agent server to restore projects
builds.get("/:projectId/source/download", async (c) => {
  const authHeader = c.req.header("Authorization");
  const expectedKey = c.env.INTERNAL_API_KEY;

  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { projectId } = c.req.param();
  const object = await c.env.ASSETS.get(`projects/${projectId}/source.zip`);

  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  const arrayBuffer = await object.arrayBuffer();
  const base64 = btoa(
    String.fromCharCode(...new Uint8Array(arrayBuffer)),
  );

  return c.json({ content: base64 });
});

export { builds };
