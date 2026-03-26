import { ollamaBackend } from "./backends/ollama.js";

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

const MAX_TURNS_PER_QUERY = Number(process.env.EIGEN_MAX_TURNS || "15");
const MODEL = process.env.EIGEN_MODEL || "qwen2.5-coder:32b";

export interface AgentEvent {
  type: "status" | "usage" | "complete" | "error" | "assistant";
  [key: string]: unknown;
}

export async function* generateFromWireframe(
  projectDir: string,
  imageBase64: string,
): AsyncGenerator<AgentEvent> {
  const prompt = `Look at this wireframe and create a simple React app that matches its layout. Keep it minimal — just the basic structure with Tailwind styling. Write src/main.tsx and any components needed, then run "npm run build" and git commit.

![wireframe](${imageBase64})`;

  yield* runAgent(projectDir, prompt, false);
}

export async function* iterateOnProject(
  projectDir: string,
  instruction: string,
  annotationBase64?: string,
): AsyncGenerator<AgentEvent> {
  let prompt = instruction;
  if (annotationBase64) {
    prompt += `\n\n![annotation](${annotationBase64})`;
  }
  prompt += `\n\nAfter changes, run "npm run build" and git commit.`;

  yield* runAgent(projectDir, prompt, true);
}

async function* runAgent(
  projectDir: string,
  prompt: string,
  isIteration: boolean,
): AsyncGenerator<AgentEvent> {
  try {
    yield* ollamaBackend({
      projectDir,
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      model: MODEL,
      maxTurns: MAX_TURNS_PER_QUERY,
      isIteration,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown agent error";
    console.error(`Agent error: ${errMsg}`);
    yield { type: "error", error: errMsg };
  }
}
