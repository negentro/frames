import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "./types";
import { projects } from "./routes/projects";
import { generate } from "./routes/generate";
import { preview } from "./routes/preview";

const app = new Hono<App>();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["Content-Type"],
  })
);

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/projects", projects);
app.route("/api/generate", generate);
app.route("/api/preview", preview);

export default app;
