import { Hono } from "hono";

const preview = new Hono();

// Serve built assets from R2 for a given project build
preview.get("/:projectId/builds/:buildId/*", (c) => {
  return c.json({ error: "not implemented" }, 501);
});

export { preview };
