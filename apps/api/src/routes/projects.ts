import { Hono } from "hono";
import type { App, Project } from "../types";

const projects = new Hono<App>();

// List all projects
projects.get("/", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM projects ORDER BY updated_at DESC"
  ).all<Project>();
  return c.json({ projects: result.results, total: result.results.length });
});

// Create a new project
projects.post("/", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO projects (id, name) VALUES (?, ?)"
  )
    .bind(id, body.name)
    .run();

  const project = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id = ?"
  )
    .bind(id)
    .first<Project>();

  return c.json(project, 201);
});

// Get a single project by ID (includes builds)
projects.get("/:id", async (c) => {
  const { id } = c.req.param();
  const project = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id = ?"
  )
    .bind(id)
    .first<Project>();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const builds = await c.env.DB.prepare(
    "SELECT * FROM builds WHERE project_id = ? ORDER BY created_at DESC"
  )
    .bind(id)
    .all();

  const usage = await c.env.DB.prepare(
    "SELECT SUM(input_tokens) as total_input_tokens, SUM(output_tokens) as total_output_tokens, SUM(cost_usd) as total_cost_usd FROM usage WHERE project_id = ?"
  )
    .bind(id)
    .first<{ total_input_tokens: number; total_output_tokens: number; total_cost_usd: number }>();

  return c.json({ ...project, builds: builds.results, usage });
});

// Delete a project by ID
projects.delete("/:id", async (c) => {
  const { id } = c.req.param();

  const project = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id = ?"
  )
    .bind(id)
    .first<Project>();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Clean up R2 assets for all builds
  const builds = await c.env.DB.prepare(
    "SELECT r2_prefix FROM builds WHERE project_id = ?"
  )
    .bind(id)
    .all<{ r2_prefix: string | null }>();

  for (const build of builds.results) {
    if (build.r2_prefix) {
      const objects = await c.env.ASSETS.list({ prefix: build.r2_prefix });
      for (const obj of objects.objects) {
        await c.env.ASSETS.delete(obj.key);
      }
    }
  }

  // Delete source zip from R2
  await c.env.ASSETS.delete(`projects/${id}/source.zip`);

  // Cascade deletes builds and usage via FK
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();

  return c.json({ id, deleted: true });
});

export { projects };
