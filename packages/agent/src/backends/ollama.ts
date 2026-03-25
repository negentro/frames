import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentBackend, BackendConfig } from "./types.js";
import type { AgentEvent } from "../agent.js";
import { writeTool } from "../tools/write.js";
import { bashTool } from "../tools/bash.js";
import { log, chatCompletion, extractImages } from "./ollama/shared.js";
import { runOrchestrator, type OrchestratorPlan } from "./ollama/orchestrator.js";
import { runSubagent } from "./ollama/subagent.js";
import { runVerifier } from "./ollama/verifier.js";
import { runReviewer } from "./ollama/reviewer.js";

const MAIN_TSX = `import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
`;

const MAX_ATTEMPTS = 3;

export const ollamaBackend: AgentBackend = async function* (
  config: BackendConfig,
): AsyncGenerator<AgentEvent> {
  log(`Ollama backend: model=${config.model}, turns=${config.maxTurns}`);
  log(`CWD: ${config.projectDir}`);

  const isIteration = existsSync(join(config.projectDir, "src", "App.tsx"));
  const { images } = extractImages(config.prompt);

  // For iterations, generate a summary message for the chat
  if (isIteration) {
    try {
      const summaryRes = await chatCompletion(config.model, [
        {
          role: "system",
          content:
            "You are a helpful assistant. Given a user's request to modify a React app, respond with a single short sentence (max 10 words) describing what will be changed. No punctuation at the end. Examples: 'Centering all heading text', 'Adding a dark mode toggle', 'Replacing the footer layout'",
        },
        { role: "user", content: config.prompt },
      ]);
      const summary =
        summaryRes.choices[0]?.message?.content?.trim() || "Applying changes";
      yield { type: "status", message: summary };
    } catch {
      yield { type: "status", message: "Applying changes" };
    }
  }

  // Write main.tsx on first generation (always hardcoded)
  if (!isIteration) {
    await writeTool(
      { file_path: "src/main.tsx", content: MAIN_TSX },
      config.projectDir,
    );
    log("Wrote hardcoded src/main.tsx");
  }

  // --- Main loop: plan → execute → verify → review → retry if needed ---
  let feedback = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log(`=== Attempt ${attempt}/${MAX_ATTEMPTS} ===`);

    // --- Phase 1: Orchestrator ---
    if (attempt === 1) {
      yield { type: "status", message: "Planning implementation" };
    }

    const collectedEvents: AgentEvent[] = [];
    let plan: OrchestratorPlan;
    try {
      const promptWithFeedback = feedback
        ? `${config.prompt}\n\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
        : config.prompt;

      plan = await runOrchestrator(
        config.model,
        config.projectDir,
        promptWithFeedback,
        collectedEvents,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", error: `Orchestrator failed: ${msg}` };
      return;
    }

    for (const ev of collectedEvents) {
      yield ev;
    }

    log(`Plan: ${plan.summary} (${plan.files.length} files)`);

    // --- Phase 2: Subagents ---
    if (attempt === 1 && images.length > 0) {
      yield { type: "status", message: "Generating initial site layout" };
    }

    const writtenFiles = new Map<string, string>();
    writtenFiles.set("src/main.tsx", MAIN_TSX);

    for (const filePlan of plan.files) {
      try {
        const result = await runSubagent(
          config.model,
          filePlan,
          config.projectDir,
          writtenFiles,
          plan,
        );

        await writeTool(
          { file_path: result.path, content: result.content },
          config.projectDir,
        );
        writtenFiles.set(result.path, result.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Subagent error for ${filePlan.path}: ${msg}`);
      }
    }

    // --- Phase 3: Verify build ---
    const verifyResult = await runVerifier(config.model, config.projectDir);
    for (const ev of verifyResult.events) {
      yield ev;
    }

    if (!verifyResult.success) {
      log(`Build failed on attempt ${attempt}`);
      feedback = `Build failed with: ${verifyResult.error}`;
      if (attempt < MAX_ATTEMPTS) {
        yield { type: "status", message: `Build failed, retrying (attempt ${attempt + 1})` };
        continue;
      }
      yield { type: "status", message: "Build failed after all attempts" };
      break;
    }

    // --- Phase 4: Review ---
    const allChangedFiles = plan.files.map((f) => f.path);
    if (!allChangedFiles.includes("src/App.tsx")) {
      allChangedFiles.push("src/App.tsx");
    }

    const review = await runReviewer(
      config.model,
      config.projectDir,
      config.prompt,
      allChangedFiles,
    );

    if (review.satisfied) {
      log("Review passed");
      break;
    }

    log(`Review failed: ${review.feedback}`);
    feedback = review.feedback;

    if (attempt < MAX_ATTEMPTS) {
      yield { type: "status", message: "Refining implementation" };
    } else {
      log("Max attempts reached, accepting current result");
    }
  }

  // --- Git commit ---
  bashTool(
    { command: 'git add -A && git commit -m "Update project"' },
    config.projectDir,
  );

  yield {
    type: "usage",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };

  yield { type: "complete", message: "Done" };
  log("Ollama backend complete");
};
