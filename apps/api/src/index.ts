import { Hono } from "hono";
import { projects } from "./routes/projects";
import { generate } from "./routes/generate";
import { preview } from "./routes/preview";

type Bindings = {
  // R2Bucket for storing built assets and uploaded images
  // ASSETS: R2Bucket;

  // D1 database for project metadata
  // DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/projects", projects);
app.route("/api/generate", generate);
app.route("/api/preview", preview);

export default app;
