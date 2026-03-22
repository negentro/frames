import { Hono } from "hono";

const projects = new Hono();

// List all projects
projects.get("/", (c) => {
  return c.json({ projects: [], total: 0 });
});

// Create a new project
projects.post("/", (c) => {
  return c.json({ id: "placeholder-id", status: "created" }, 201);
});

// Get a single project by ID
projects.get("/:id", (c) => {
  const { id } = c.req.param();
  return c.json({ id, name: "Placeholder Project", status: "active" });
});

// Delete a project by ID
projects.delete("/:id", (c) => {
  const { id } = c.req.param();
  return c.json({ id, deleted: true });
});

export { projects };
