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
    // Strip images from prompt for summary — only need the text instruction
    const { text: summaryText } = extractImages(config.prompt);
    try {
      const summaryRes = await chatCompletion(config.model, [
        {
          role: "system",
          content:
            "You are a helpful assistant. Given a user's request to modify a React app, respond with a single short sentence (max 10 words) describing what will be changed. No punctuation at the end. Examples: 'Centering all heading text', 'Adding a dark mode toggle', 'Replacing the footer layout'",
        },
        { role: "user", content: summaryText },
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

  // --- Pre-describe images once (cached for retry loop) ---
  let textPrompt = config.prompt;
  const { images: promptImages } = extractImages(config.prompt);
  if (promptImages.length > 0) {
    yield { type: "status", message: "Analyzing wireframe" };
    const { describeImage, VISION_MODEL: vm } = await import("./ollama/shared.js");
    const descriptions: string[] = [];
    for (const img of promptImages) {
      const desc = await describeImage(img, vm);
      descriptions.push(desc);
    }
    // Replace image markdown with text descriptions
    textPrompt = extractImages(config.prompt).text +
      "\n\n" +
      descriptions.map((d, i) => `[Wireframe ${i + 1} description]:\n${d}`).join("\n\n");
    log(`Pre-described ${promptImages.length} image(s), text prompt ${textPrompt.length} chars`);

    // Fail fast if vision model returned unusable descriptions
    const badDescriptions = descriptions.filter(
      (d) => d === "Unable to describe image" || d.length < 20,
    );
    if (badDescriptions.length > 0) {
      log(`Vision failed: ${badDescriptions.length}/${descriptions.length} descriptions unusable`);
      yield { type: "error", error: "Vision model failed to analyze the wireframe. Please try again or use a text description instead." };
      return;
    }
  }

  // --- Main loop: plan → execute → verify → retry if needed ---
  let feedback = "";
  let buildSucceeded = false;

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
        ? `${textPrompt}\n\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
        : textPrompt;

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

    // On retry after build failure, force all files to "create" (rewrite from scratch)
    // — modifying broken files just layers errors on errors
    if (attempt > 1 && feedback.includes("Build failed")) {
      plan.files = plan.files.map((f) => ({ ...f, action: "create" as const }));
      log("Retry: forcing all files to action=create (rewrite)");
    }

    log(`Plan: ${plan.summary} (${plan.files.length} files)`);

    // --- Phase 2: Subagents ---
    if (attempt === 1 && images.length > 0) {
      yield { type: "status", message: "Generating initial site layout" };
    }

    const writtenFiles = new Map<string, string>();
    writtenFiles.set("src/main.tsx", MAIN_TSX);

    let subagentFailures = 0;
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
        subagentFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        log(`Subagent error for ${filePlan.path}: ${msg}`);
      }
    }

    // If all subagents failed, skip build and retry from scratch
    if (subagentFailures === plan.files.length && plan.files.length > 0) {
      log(`All ${subagentFailures} subagents failed, skipping build`);
      feedback = "All code generation subagents failed — no files were written. Simplify the plan and use fewer files.";
      if (attempt < MAX_ATTEMPTS) {
        yield { type: "status", message: `Code generation failed, retrying (attempt ${attempt + 1})` };
        continue;
      }
      yield { type: "status", message: "Code generation failed after all attempts" };
      break;
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

    buildSucceeded = true;

    // Build passed — run reviewer
    log("Build passed, running reviewer");
    yield { type: "status", message: "Reviewing implementation" };

    const changedFiles = plan.files.map((f) => f.path);
    const reviewResult = await runReviewer(
      config.model,
      config.projectDir,
      textPrompt,
      changedFiles,
    );

    if (reviewResult.satisfied) {
      log("Reviewer satisfied, accepting result");
      break;
    }

    log(`Reviewer not satisfied: ${reviewResult.feedback}`);
    feedback = `Build succeeded but review failed: ${reviewResult.feedback}`;
    if (attempt < MAX_ATTEMPTS) {
      buildSucceeded = false; // reset — need to rebuild on next attempt
      yield { type: "status", message: `Review failed, retrying (attempt ${attempt + 1})` };
      continue;
    }
    yield { type: "status", message: "Review failed after all attempts, accepting result" };
    break;
  }

  // --- Git commit (save partial work even on failure) ---
  bashTool({ command: "git add -A" }, config.projectDir);
  bashTool(
    { command: 'git commit -m "Update project"' },
    config.projectDir,
  );

  yield {
    type: "usage",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };

  if (!buildSucceeded) {
    yield { type: "error", error: "Agent failed to produce a working build after all attempts" };
    log("Ollama backend failed — no successful build");
    return;
  }

  yield { type: "complete", message: "Done" };
  log("Ollama backend complete");
};
