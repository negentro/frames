import http from "node:http";
import { generateFromWireframe, iterateOnProject } from "./agent";

const PORT = 8787;

const server = http.createServer(async (req, res) => {
  // Set JSON content type for all responses
  res.setHeader("Content-Type", "application/json");

  // Collect request body
  const body = await new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
  });

  try {
    if (req.method === "POST" && req.url === "/generate") {
      // POST /generate - Initial generation from a wireframe image
      // Accepts: { imageBase64: string }
      // Streams back agent status messages as the wireframe is analyzed
      // and a React SPA is generated from scratch.
      const { imageBase64 } = JSON.parse(body || "{}");

      const messages: unknown[] = [];
      for await (const msg of generateFromWireframe(imageBase64)) {
        messages.push(msg);
      }

      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok", messages }));
      return;
    }

    if (req.method === "POST" && req.url === "/iterate") {
      // POST /iterate - Iterate on an existing generated project
      // Accepts: { projectDir: string, instruction: string, annotationBase64?: string }
      // Takes a user instruction (and optional annotated screenshot) and applies
      // changes to the existing project via the agent.
      const { projectDir, instruction, annotationBase64 } = JSON.parse(
        body || "{}"
      );

      const messages: unknown[] = [];
      for await (const msg of iterateOnProject(
        projectDir,
        instruction,
        annotationBase64
      )) {
        messages.push(msg);
      }

      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok", messages }));
      return;
    }

    // Unknown route
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    res.writeHead(500);
    res.end(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" })
    );
  }
});

server.listen(PORT, () => {
  console.log(`Agent server listening on port ${PORT}`);
});
