import { Hono } from "hono";

const generate = new Hono();

// Kick off initial generation from an image + prompt
// TODO: This will SSE stream progress updates in the real implementation
generate.post("/", (c) => {
  return c.json({
    id: "placeholder-generation-id",
    projectId: "placeholder-project-id",
    status: "queued",
  });
});

// Iterate on an existing project with text feedback + optional annotated image
// TODO: This will SSE stream progress updates in the real implementation
generate.post("/:id/iterate", (c) => {
  const { id } = c.req.param();
  return c.json({
    id: "placeholder-iteration-id",
    projectId: id,
    status: "queued",
  });
});

export { generate };
