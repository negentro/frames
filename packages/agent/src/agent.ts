import { claudeBackend } from "./backends/claude.js";
import { ollamaBackend } from "./backends/ollama.js";
import { describeImageWithClaude } from "./backends/claude-vision.js";
import type { AgentBackend } from "./backends/types.js";

const SYSTEM_PROMPT = `You are a frontend developer. Generate a simple React + TypeScript app.

The project is already set up in your current working directory with dependencies installed. Use RELATIVE paths (e.g. "src/App.tsx"), never absolute paths. Do NOT search for files — they are in the cwd.

Do NOT modify package.json, vite.config.ts, tsconfig.json, or index.html.

CRITICAL RULES:
- src/index.css already exists with Tailwind v4 via \`@import "tailwindcss"\`. Do NOT import Tailwind anywhere else.
- React 19 does NOT have ReactDOM.render(). You MUST use createRoot.
- src/main.tsx is already created. Do NOT overwrite it.
- Only create files under src/.
- Do NOT run git push, git remote, or any network commands.
- Do NOT use find or ls to explore. Just write your files directly.
- Write ALL files first, then run "npm run build", then "git add -A", then "git commit -m 'description'". Each as a separate command.

Available libraries: react 19, react-dom 19, react-router-dom v7, tailwindcss v4, lucide-react, clsx.

Be concise. Write minimal code that works.`;

const MAX_BUDGET_PER_QUERY_USD = Number(
  process.env.EIGEN_MAX_BUDGET_PER_QUERY_USD || "1.00",
);
const MAX_TURNS_PER_QUERY = Number(process.env.EIGEN_MAX_TURNS || "15");
const MODEL = process.env.EIGEN_MODEL || "claude-sonnet-4-6";

const ITERATION_MODEL =
  process.env.EIGEN_ITERATION_MODEL || "claude-haiku-4-5-20251001";
const ITERATION_BUDGET = Number(
  process.env.EIGEN_ITERATION_BUDGET_USD || "0.25",
);

const BACKENDS: Record<string, AgentBackend> = {
  claude: claudeBackend,
  ollama: ollamaBackend,
};

function getBackend(): AgentBackend {
  const provider = process.env.MODEL_PROVIDER;
  if (!provider) {
    throw new Error(
      "MODEL_PROVIDER env var is required. Set to 'claude' or 'ollama'.",
    );
  }
  const backend = BACKENDS[provider];
  if (!backend) {
    throw new Error(
      `Unknown MODEL_PROVIDER: "${provider}". Must be 'claude' or 'ollama'.`,
    );
  }
  return backend;
}

// Extract and describe images, returning a text-only prompt
// This is used for Claude to avoid re-sending base64 on every turn
async function describeImages(
  prompt: string,
  events: AgentEvent[],
): Promise<string> {
  const IMAGE_PATTERN = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
  const images: string[] = [];
  const textPrompt = prompt.replace(IMAGE_PATTERN, (_, dataUrl: string) => {
    images.push(dataUrl);
    return "";
  });

  if (images.length === 0) {
    console.log("[vision] No images in prompt, skipping vision");
    return prompt;
  }

  const isClaude = process.env.MODEL_PROVIDER === "claude";
  // Ollama: let the orchestrator handle images via DescribeImage tool
  if (!isClaude) return prompt;

  events.push({ type: "status", message: "Analyzing wireframe" });

  const descriptions: string[] = [];
  for (const img of images) {
    console.log(`[vision] Describing image (${img.length} chars data URL)`);
    const desc = await describeImageWithClaude(img);
    console.log(`[vision] Description result (${desc.length} chars): ${desc.slice(0, 300)}`);
    descriptions.push(desc);
  }

  const finalPrompt =
    textPrompt.trim() +
    "\n\n" +
    descriptions
      .map((d, i) => `[Wireframe ${i + 1} description]:\n${d}`)
      .join("\n\n");

  console.log(`[vision] Final prompt to agent (${finalPrompt.length} chars): ${finalPrompt.slice(0, 500)}`);
  return finalPrompt;
}

export interface AgentEvent {
  type: "status" | "usage" | "complete" | "error" | "assistant";
  [key: string]: unknown;
}

export async function* generateFromWireframe(
  projectDir: string,
  imageBase64: string,
): AsyncGenerator<AgentEvent> {
  const rawPrompt = `Look at this wireframe and create a simple React app that matches its layout. Keep it minimal — just the basic structure with Tailwind styling. Write src/main.tsx and any components needed, then run "npm run build" and git commit.

![wireframe](${imageBase64})`;

  // Describe image first so the agent loop gets text only
  const events: AgentEvent[] = [];
  const prompt = await describeImages(rawPrompt, events);
  for (const ev of events) yield ev;

  yield* runAgent(projectDir, prompt, false);
}

export async function* iterateOnProject(
  projectDir: string,
  instruction: string,
  annotationBase64?: string,
): AsyncGenerator<AgentEvent> {
  let rawPrompt = instruction;
  if (annotationBase64) {
    rawPrompt += `\n\n![annotation](${annotationBase64})`;
  }
  rawPrompt += `\n\nAfter changes, run "npm run build" and git commit.`;

  // Describe any images first
  const events: AgentEvent[] = [];
  const prompt = await describeImages(rawPrompt, events);
  for (const ev of events) yield ev;

  yield* runAgent(projectDir, prompt, true);
}

async function* runAgent(
  projectDir: string,
  prompt: string,
  isIteration: boolean,
): AsyncGenerator<AgentEvent> {
  const backend = getBackend();
  const isClaude = process.env.MODEL_PROVIDER === "claude";

  const model = isIteration && isClaude ? ITERATION_MODEL : MODEL;
  const budget = isIteration ? ITERATION_BUDGET : MAX_BUDGET_PER_QUERY_USD;

  try {
    yield* backend({
      projectDir,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      model,
      maxTurns: MAX_TURNS_PER_QUERY,
      maxBudgetUsd: budget,
      isIteration,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown agent error";
    console.error(`Agent error: ${errMsg}`);
    yield { type: "error", error: errMsg };
  }
}
