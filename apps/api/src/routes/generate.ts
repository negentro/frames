import { Hono } from "hono";
import type { App } from "../types";
import { validate } from "../validate";

const generate = new Hono<App>();

// Create project and build records, return IDs for the frontend to stream from agent directly
generate.post("/", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const err = validate(body, [
    { field: "name", type: "string", required: true, maxLength: 200 },
  ]);
  if (err) return c.json({ error: err }, 400);

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
  const err = validate(body, [
    { field: "buildId", type: "string", required: true, maxLength: 100 },
  ]);
  if (err) return c.json({ error: err }, 400);

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
  const err = validate(body, [
    { field: "buildId", type: "string", required: true, maxLength: 100 },
  ]);
  if (err) return c.json({ error: err }, 400);

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

// Undo last iteration — delete latest build and its messages, revert to previous build
generate.post("/:id/undo", async (c) => {
  const { id: projectId } = c.req.param();

  // Get the last two builds (latest to delete, previous to restore)
  const builds = await c.env.DB.prepare(
    "SELECT id FROM builds WHERE project_id = ? ORDER BY created_at DESC LIMIT 2",
  )
    .bind(projectId)
    .all<{ id: string }>();

  if (builds.results.length < 2) {
    return c.json({ error: "Cannot undo initial generation" }, 400);
  }

  const latestBuildId = builds.results[0].id;
  const previousBuildId = builds.results[1].id;

  // Get the latest user message (to return to the input box)
  const lastUserMsg = await c.env.DB.prepare(
    "SELECT content FROM messages WHERE project_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 1",
  )
    .bind(projectId)
    .first<{ content: string }>();

  // Delete the latest build, its usage, and the last pair of messages (user + system)
  // Find messages after the previous build's timestamp
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM builds WHERE id = ?").bind(latestBuildId),
    c.env.DB.prepare("DELETE FROM usage WHERE build_id = ?").bind(latestBuildId),
    // Delete the last user message and all system messages after it
    c.env.DB.prepare(
      "DELETE FROM messages WHERE project_id = ? AND id >= (SELECT MAX(id) FROM messages WHERE project_id = ? AND role = 'user')",
    ).bind(projectId, projectId),
    c.env.DB.prepare(
      "UPDATE projects SET status = 'ready', updated_at = datetime('now') WHERE id = ?",
    ).bind(projectId),
    c.env.DB.prepare(
      "UPDATE builds SET status = 'ready' WHERE id = ?",
    ).bind(previousBuildId),
  ]);

  return c.json({
    ok: true,
    previousBuildId,
    undoneMessage: lastUserMsg?.content || "",
  });
});

export { generate };
