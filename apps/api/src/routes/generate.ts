import { Hono } from "hono";
import type { App } from "../types";

const generate = new Hono<App>();

// Create project and build records, return IDs for the frontend to stream from agent directly
generate.post("/", async (c) => {
  const body = await c.req.json<{ name: string; image: string }>();
  const projectId = crypto.randomUUID();
  const buildId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO projects (id, name, status) VALUES (?, ?, 'generating')",
    ).bind(projectId, body.name),
    c.env.DB.prepare(
      "INSERT INTO builds (id, project_id, status) VALUES (?, ?, 'building')",
    ).bind(buildId, projectId),
  ]);

  return c.json({ projectId, buildId });
});

// Create build record for iteration
generate.post("/:id/iterate", async (c) => {
  const { id: projectId } = c.req.param();
  const buildId = crypto.randomUUID();

  const project = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id = ?",
  )
    .bind(projectId)
    .first();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE projects SET status = 'generating', updated_at = datetime('now') WHERE id = ?",
    ).bind(projectId),
    c.env.DB.prepare(
      "INSERT INTO builds (id, project_id, status) VALUES (?, ?, 'building')",
    ).bind(buildId, projectId),
  ]);

  return c.json({ projectId, buildId });
});

// Called by frontend when generation/iteration completes
generate.post("/:id/complete", async (c) => {
  const { id: projectId } = c.req.param();
  const body = await c.req.json<{
    buildId: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    };
  }>();

  const r2Prefix = `projects/${projectId}/builds/${body.buildId}/`;

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE projects SET status = 'ready', updated_at = datetime('now') WHERE id = ?",
    ).bind(projectId),
    c.env.DB.prepare(
      "UPDATE builds SET status = 'ready', r2_prefix = ? WHERE id = ?",
    ).bind(r2Prefix, body.buildId),
    ...(body.usage
      ? [
          c.env.DB.prepare(
            "INSERT INTO usage (id, project_id, build_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(
            crypto.randomUUID(),
            projectId,
            body.buildId,
            body.usage.input_tokens,
            body.usage.output_tokens,
            body.usage.cost_usd,
          ),
        ]
      : []),
  ]);

  return c.json({ ok: true });
});

// Called by frontend when generation/iteration fails
generate.post("/:id/error", async (c) => {
  const { id: projectId } = c.req.param();
  const body = await c.req.json<{ buildId: string }>();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE id = ?",
    ).bind(projectId),
    c.env.DB.prepare(
      "UPDATE builds SET status = 'error' WHERE id = ?",
    ).bind(body.buildId),
  ]);

  return c.json({ ok: true });
});

export { generate };
