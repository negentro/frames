import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { App } from "../types";

const generate = new Hono<App>();

// Initial generation from wireframe image
generate.post("/", async (c) => {
  const body = await c.req.json<{ name: string; image: string }>();
  const projectId = crypto.randomUUID();
  const buildId = crypto.randomUUID();

  // Create project and initial build record
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO projects (id, name, status) VALUES (?, ?, 'generating')")
      .bind(projectId, body.name),
    c.env.DB.prepare("INSERT INTO builds (id, project_id, status) VALUES (?, ?, 'building')")
      .bind(buildId, projectId),
  ]);

  return streamSSE(c, async (stream) => {
    // Send initial metadata
    await stream.writeSSE({
      event: "init",
      data: JSON.stringify({ projectId, buildId }),
    });

    try {
      // Forward to agent container
      const agentRes = await fetch(`${c.env.AGENT_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          buildId,
          image: body.image,
        }),
      });

      if (!agentRes.ok || !agentRes.body) {
        throw new Error(`Agent returned ${agentRes.status}`);
      }

      // Relay agent SSE stream to the client
      const reader = agentRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const msg = JSON.parse(data);

              // Track usage if present
              if (msg.type === "usage") {
                await c.env.DB.prepare(
                  "INSERT INTO usage (id, project_id, build_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)"
                )
                  .bind(crypto.randomUUID(), projectId, buildId, msg.input_tokens, msg.output_tokens, msg.cost_usd)
                  .run();
              }

              await stream.writeSSE({ event: msg.type, data });
            } catch {
              await stream.writeSSE({ event: "status", data });
            }
          }
        }
      }

      // Update statuses to ready
      const r2Prefix = `projects/${projectId}/builds/${buildId}/`;
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE projects SET status = 'ready', updated_at = datetime('now') WHERE id = ?")
          .bind(projectId),
        c.env.DB.prepare("UPDATE builds SET status = 'ready', r2_prefix = ? WHERE id = ?")
          .bind(r2Prefix, buildId),
      ]);

      await stream.writeSSE({
        event: "complete",
        data: JSON.stringify({ projectId, buildId, r2Prefix }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE id = ?")
          .bind(projectId),
        c.env.DB.prepare("UPDATE builds SET status = 'error' WHERE id = ?")
          .bind(buildId),
      ]);

      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: message }),
      });
    }
  });
});

// Iterate on an existing project
generate.post("/:id/iterate", async (c) => {
  const { id: projectId } = c.req.param();
  const body = await c.req.json<{ instruction: string; annotation?: string }>();
  const buildId = crypto.randomUUID();

  // Verify project exists
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Create new build record
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE projects SET status = 'generating', updated_at = datetime('now') WHERE id = ?")
      .bind(projectId),
    c.env.DB.prepare("INSERT INTO builds (id, project_id, status) VALUES (?, ?, 'building')")
      .bind(buildId, projectId),
  ]);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "init",
      data: JSON.stringify({ projectId, buildId }),
    });

    try {
      const agentRes = await fetch(`${c.env.AGENT_URL}/iterate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          buildId,
          instruction: body.instruction,
          annotation: body.annotation,
        }),
      });

      if (!agentRes.ok || !agentRes.body) {
        throw new Error(`Agent returned ${agentRes.status}`);
      }

      const reader = agentRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const msg = JSON.parse(data);

              if (msg.type === "usage") {
                await c.env.DB.prepare(
                  "INSERT INTO usage (id, project_id, build_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)"
                )
                  .bind(crypto.randomUUID(), projectId, buildId, msg.input_tokens, msg.output_tokens, msg.cost_usd)
                  .run();
              }

              await stream.writeSSE({ event: msg.type, data });
            } catch {
              await stream.writeSSE({ event: "status", data });
            }
          }
        }
      }

      const r2Prefix = `projects/${projectId}/builds/${buildId}/`;
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE projects SET status = 'ready', updated_at = datetime('now') WHERE id = ?")
          .bind(projectId),
        c.env.DB.prepare("UPDATE builds SET status = 'ready', r2_prefix = ? WHERE id = ?")
          .bind(r2Prefix, buildId),
      ]);

      await stream.writeSSE({
        event: "complete",
        data: JSON.stringify({ projectId, buildId, r2Prefix }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE id = ?")
          .bind(projectId),
        c.env.DB.prepare("UPDATE builds SET status = 'error' WHERE id = ?")
          .bind(buildId),
      ]);

      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: message }),
      });
    }
  });
});

export { generate };
