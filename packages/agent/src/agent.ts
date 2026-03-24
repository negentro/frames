import { claudeBackend } from "./backends/claude.js";
import { ollamaBackend } from "./backends/ollama.js";
import type { AgentBackend } from "./backends/types.js";

const SYSTEM_PROMPT = `You are a frontend developer. Generate a simple React + TypeScript app.

The project is already set up with dependencies installed. Do NOT modify package.json, vite.config.ts, tsconfig.json, or index.html.

CRITICAL RULES:
- src/index.css already exists with Tailwind v4 via \`@import "tailwindcss"\`. Do NOT import Tailwind anywhere else.
- Tailwind v4 does NOT use tailwindcss/tailwind.css or tailwind.config.js.
- React 19 does NOT have ReactDOM.render(). You MUST use createRoot.
- Only create files under src/.
- Do NOT run git push, git remote, or any network commands. Only use git for local commits.

src/main.tsx MUST follow this exact pattern:
\`\`\`tsx
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
\`\`\`

Available libraries: react 19, react-dom 19, react-router-dom v7, tailwindcss v4, lucide-react, clsx.

Be concise. Write minimal code that works. After writing files, run "npm run build" to verify it compiles. If it fails, fix it. Then git commit.`;

const MAX_BUDGET_PER_QUERY_USD = Number(
  process.env.EIGEN_MAX_BUDGET_PER_QUERY_USD || "1.00",
);
const MAX_TURNS_PER_QUERY = Number(process.env.EIGEN_MAX_TURNS || "15");
const MODEL = process.env.EIGEN_MODEL || "claude-sonnet-4-6";

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

export interface AgentEvent {
  type: "status" | "usage" | "complete" | "error" | "assistant";
  [key: string]: unknown;
}

export async function* generateFromWireframe(
  projectDir: string,
  imageBase64: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "status", message: "Analyzing wireframe" };

  const prompt = `Look at this wireframe and create a simple React app that matches its layout. Keep it minimal — just the basic structure with Tailwind styling. Write src/main.tsx and any components needed, then run "npm run build" and git commit.

![wireframe](${imageBase64})`;

  yield* runAgent(projectDir, prompt);
}

export async function* iterateOnProject(
  projectDir: string,
  instruction: string,
  annotationBase64?: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "status", message: "Applying changes" };

  let prompt = instruction;
  if (annotationBase64) {
    prompt += `\n\n![annotation](${annotationBase64})`;
  }
  prompt += `\n\nAfter changes, run "npm run build" and git commit.`;

  yield* runAgent(projectDir, prompt);
}

async function* runAgent(
  projectDir: string,
  prompt: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "status", message: "Starting agent" };

  const backend = getBackend();

  try {
    yield* backend({
      projectDir,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      model: MODEL,
      maxTurns: MAX_TURNS_PER_QUERY,
      maxBudgetUsd: MAX_BUDGET_PER_QUERY_USD,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown agent error";
    console.error(`Agent error: ${errMsg}`);
    yield { type: "error", error: errMsg };
  }
}
