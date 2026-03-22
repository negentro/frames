/**
 * Core agent orchestration module.
 *
 * Planned Agent SDK integration:
 * - Use @anthropic-ai/claude-agent-sdk to create an Agent instance
 * - Call agent.query() with the wireframe image (as base64) or iteration instruction
 * - Allowed tools will include:
 *     - file_write  - write files into the generated project directory
 *     - file_read   - read existing project files during iteration
 *     - bash        - run npm install, npm run build, etc.
 * - The agent will receive the template files (package.json, vite.config.ts, etc.)
 *   as part of its system prompt so it knows the project structure.
 * - Streamed tool-use events from agent.query() will be yielded as status messages
 *   back to the caller for real-time progress updates.
 */

export interface StatusMessage {
  type: "status";
  message: string;
}

export interface CompleteMessage {
  type: "complete";
  message: string;
}

export type AgentMessage = StatusMessage | CompleteMessage;

/**
 * Generate a React SPA from a wireframe image.
 *
 * Takes a base64-encoded wireframe image, analyzes its layout, components,
 * and interactions, then generates a complete React + Tailwind project.
 *
 * Planned flow:
 * 1. Send wireframe image to Claude via agent.query() with vision
 * 2. Agent analyzes the wireframe and plans component hierarchy
 * 3. Agent writes project files (components, routes, styles) using file_write tool
 * 4. Agent runs npm install && npm run build via bash tool to verify the build
 * 5. Yield status/progress messages throughout
 */
export async function* generateFromWireframe(
  imageBase64: string
): AsyncGenerator<AgentMessage> {
  // TODO: Initialize Agent SDK client and call agent.query() with the wireframe image
  // const agent = new Agent({ model: "claude-sonnet-4-20250514", tools: [...] });
  // for await (const event of agent.query({ image: imageBase64, prompt: "..." })) { ... }

  yield { type: "status", message: "Analyzing wireframe..." };
  yield { type: "status", message: "Planning component hierarchy..." };
  yield { type: "status", message: "Generating components..." };
  yield { type: "status", message: "Writing project files..." };
  yield { type: "status", message: "Verifying build..." };
  yield { type: "complete", message: "Generation complete" };
}

/**
 * Iterate on an existing generated project.
 *
 * Takes a project directory path, a user instruction describing the desired changes,
 * and an optional annotated screenshot highlighting areas to modify.
 *
 * Planned flow:
 * 1. Read existing project files via file_read tool to understand current state
 * 2. Send instruction (+ optional annotation image) to Claude via agent.query()
 * 3. Agent modifies project files using file_write tool
 * 4. Agent runs npm run build via bash tool to verify changes compile
 * 5. Yield status/progress messages throughout
 */
export async function* iterateOnProject(
  projectDir: string,
  instruction: string,
  annotationBase64?: string
): AsyncGenerator<AgentMessage> {
  // TODO: Initialize Agent SDK client and call agent.query() with instruction + annotation
  // const agent = new Agent({ model: "claude-sonnet-4-20250514", tools: [...] });
  // for await (const event of agent.query({ prompt: instruction, image: annotationBase64, cwd: projectDir })) { ... }

  yield { type: "status", message: "Reading existing project..." };
  yield { type: "status", message: "Analyzing requested changes..." };
  yield { type: "status", message: "Applying modifications..." };
  yield { type: "status", message: "Verifying build..." };
  yield { type: "complete", message: "Iteration complete" };
}
