import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "../../agent.js";
import { executeTool } from "../../tools/index.js";
import {
  chatCompletion,
  describeImage,
  extractImages,
  extractToolCallsFromText,
  extractJSON,
  log,
  VISION_MODEL,
  type ChatMessage,
} from "./shared.js";

export interface FilePlan {
  path: string;
  action: "create" | "modify";
  description: string;
}

export interface OrchestratorPlan {
  summary: string;
  files: FilePlan[];
}

const ORCHESTRATOR_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "Read",
      description: "Read the contents of a file",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to read (relative to project root)",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "Bash",
      description: "Execute a shell command and return its output",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "DescribeImage",
      description:
        "Analyze a wireframe or UI image using a vision model. Pass the image ID (e.g. 'image_1').",
      parameters: {
        type: "object",
        properties: {
          image_id: {
            type: "string",
            description: "The image identifier (e.g. 'image_1', 'image_2')",
          },
        },
        required: ["image_id"],
      },
    },
  },
];

const KNOWN_ORCHESTRATOR_TOOLS = new Set(["Read", "Bash", "DescribeImage"]);

const PLAN_SCHEMA = `{
  "summary": "One sentence describing what will be built or changed",
  "files": [
    {
      "path": "src/components/Example.tsx",
      "action": "create",
      "description": "Description of what this file should contain"
    }
  ]
}`;

function buildSystemPrompt(isIteration: boolean, hasImages: boolean): string {
  const tools: string[] = [];
  if (isIteration) {
    tools.push("- Read: Read files to understand the current project state");
    tools.push('- Bash: Run commands like "ls src/" to explore the project');
  }
  if (hasImages) {
    tools.push("- DescribeImage: Analyze a wireframe/UI image (pass the image_id, e.g. 'image_1')");
  }

  const toolSection = tools.length > 0
    ? `You have access to tools:\n${tools.join("\n")}\n\nUse these tools first to understand the context, then return your plan.\n\n`
    : "";

  return `You are a project planner for React + TypeScript apps with Tailwind v4.

${toolSection}Given a user's request, return a JSON plan listing every file that needs to be created or modified under src/.

CRITICAL RULES:
- Do NOT include src/main.tsx or src/index.css in the plan. They are pre-generated.
- Do NOT modify package.json, vite.config.ts, tsconfig.json, or index.html.
- Do NOT use react-router-dom unless the user specifically requests routing/multiple pages.
- Do NOT create placeholder, example, or demo components. Every file must serve the user's request.
- Do NOT create utility files unless absolutely necessary.
- src/App.tsx MUST always be the LAST file in the plan. It imports and composes the components.
- All components go under src/components/. Use default exports.
- Available libraries: react 19, react-dom 19, tailwindcss v4 (utility classes only), lucide-react, clsx.
- Keep the app minimal. Prefer fewer files. A simple layout needs only components + App.tsx.
- For "modify" actions, the description MUST be a specific CODE CHANGE instruction (e.g. "Change the outer div className to use h-screen instead of min-h-screen"). It must NOT be the user's raw words or content to display.
- Only include files that actually need changes. Do NOT rewrite files that are already correct.
- Prefer modifying existing files over creating new ones.
- Every file you list MUST be implemented. Do not reference files that are not in your plan.

Respond with ONLY a JSON object matching this schema (no markdown, no explanation):
${PLAN_SCHEMA}`;
}

export async function runOrchestrator(
  model: string,
  projectDir: string,
  prompt: string,
  events: AgentEvent[],
): Promise<OrchestratorPlan> {
  const isIteration = existsSync(join(projectDir, "src", "App.tsx"));
  const { text, images } = extractImages(prompt);

  // Store images in a lookup so the orchestrator can reference them by ID
  const imageMap = new Map<string, string>();
  images.forEach((img, i) => imageMap.set(`image_${i + 1}`, img));

  // Build user prompt — reference images by ID, not raw data
  let userPrompt = text;
  if (images.length > 0) {
    userPrompt +=
      "\n\nThe user provided wireframe image(s). Use the DescribeImage tool to analyze them before planning:\n" +
      images.map((_, i) => `- image_${i + 1}`).join("\n");
  }

  const hasImages = images.length > 0;
  const needsTools = isIteration || hasImages;

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(isIteration, hasImages) },
    { role: "user", content: userPrompt },
  ];

  // If we need tools (iteration or images), run a mini tool loop
  if (needsTools) {
    const maxPlanningTurns = 8;
    for (let turn = 0; turn < maxPlanningTurns; turn++) {
      log(`Orchestrator planning turn ${turn + 1}/${maxPlanningTurns}`);

      const response = await chatCompletion(
        model,
        messages,
        ORCHESTRATOR_TOOLS,
      );
      const assistantMsg = response.choices[0]?.message;
      if (!assistantMsg) throw new Error("No orchestrator response");

      const content = assistantMsg.content || "";

      // Check for structured tool calls first, then text-extracted
      interface ToolCallEntry { name: string; id?: string; arguments: Record<string, unknown> }
      let toolCalls: ToolCallEntry[] = [];
      let hasStructuredCalls = false;

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        hasStructuredCalls = true;
        toolCalls = assistantMsg.tool_calls.map((tc) => ({
          name: tc.function.name,
          id: tc.id,
          arguments:
            typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments,
        }));
        log(`Orchestrator: ${toolCalls.length} structured tool call(s)`);
      } else if (content) {
        const textCalls = extractToolCallsFromText(content, KNOWN_ORCHESTRATOR_TOOLS);
        toolCalls = textCalls;
      }

      if (toolCalls.length === 0) {
        // No tool calls — should be the JSON plan
        log(`Orchestrator raw response: ${content.slice(0, 500)}`);
        return parsePlan(content, prompt);
      }

      // Execute tools and feed results back
      messages.push({
        role: "assistant",
        content: content,
        ...(hasStructuredCalls ? { tool_calls: assistantMsg.tool_calls } : {}),
      });

      const results: string[] = [];
      for (const tc of toolCalls) {
        const detail =
          (tc.arguments.file_path as string) ||
          (tc.arguments.command as string) ||
          (tc.arguments.image_id as string) ||
          "";
        log(`Orchestrator tool: ${tc.name} ${detail}`);

        let result: string;
        if (tc.name === "DescribeImage") {
          const imageId = tc.arguments.image_id as string;
          const dataUrl = imageMap.get(imageId);
          if (!dataUrl) {
            result = `Error: unknown image_id "${imageId}"`;
          } else {
            events.push({ type: "status", message: "Analyzing wireframe" });
            result = await describeImage(dataUrl, VISION_MODEL);
          }
        } else {
          result = await executeTool(tc.name, tc.arguments, projectDir);
        }
        results.push(`[${tc.name}]: ${result}`);
      }

      // Feed results back — structured or text format
      if (hasStructuredCalls && assistantMsg.tool_calls) {
        for (let i = 0; i < assistantMsg.tool_calls.length; i++) {
          messages.push({
            role: "tool",
            tool_call_id: assistantMsg.tool_calls[i].id,
            content: results[i] || "Done",
          });
        }
      } else {
        messages.push({
          role: "user",
          content: `Tool results:\n${results.join("\n\n")}\n\nNow return your JSON plan.`,
        });
      }
    }

    // If we exhausted turns, try to get a plan from the last response
    log("Orchestrator exhausted planning turns, requesting final plan");
    messages.push({
      role: "user",
      content: "Please return your JSON plan now.",
    });
    const finalRes = await chatCompletion(model, messages);
    return parsePlan(
      finalRes.choices[0]?.message?.content || "",
      prompt,
    );
  }

  // No tools needed — single-turn plan
  log("Orchestrator: single-turn planning (initial generation, no images)");
  const response = await chatCompletion(model, messages);
  return parsePlan(
    response.choices[0]?.message?.content || "",
    prompt,
  );
}

function parsePlan(text: string, fallbackPrompt: string): OrchestratorPlan {
  const jsonStr = extractJSON(text);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.summary && Array.isArray(parsed.files) && parsed.files.length > 0) {
        // Filter out main.tsx and index.css — we handle those ourselves
        parsed.files = parsed.files.filter(
          (f: FilePlan) =>
            f.path !== "src/main.tsx" && f.path !== "src/index.css",
        );
        // Ensure App.tsx is last
        const appIdx = parsed.files.findIndex(
          (f: FilePlan) => f.path === "src/App.tsx",
        );
        if (appIdx > -1 && appIdx < parsed.files.length - 1) {
          const [app] = parsed.files.splice(appIdx, 1);
          parsed.files.push(app);
        }
        log(`Orchestrator plan: ${parsed.files.length} files — ${parsed.summary}`);
        return parsed as OrchestratorPlan;
      }
    } catch {
      // Fall through
    }
  }

  log("Orchestrator plan parse failed, using fallback");
  return {
    summary: "Generating app from request",
    files: [
      {
        path: "src/App.tsx",
        action: "create",
        description: `Single-file app that implements: ${fallbackPrompt}. Use Tailwind utility classes for styling. Default export.`,
      },
    ],
  };
}
