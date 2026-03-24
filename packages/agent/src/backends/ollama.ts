import type { AgentBackend, BackendConfig } from "./types.js";
import type { AgentEvent } from "../agent.js";
import { TOOL_DEFINITIONS, executeTool } from "../tools/index.js";

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "qwen2.5vl";

interface ToolCall {
  id: string;
  function: { name: string; arguments: string | Record<string, unknown> };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ChatResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: ToolCall[] };
    finish_reason: string;
  }>;
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// Match markdown image syntax: ![alt](data:image/...;base64,...)
const IMAGE_PATTERN = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;

function extractImages(prompt: string): {
  text: string;
  images: string[];
} {
  const images: string[] = [];
  const text = prompt.replace(IMAGE_PATTERN, (_, dataUrl: string) => {
    images.push(dataUrl);
    return "";
  });
  return { text: text.trim(), images };
}

async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  tools?: typeof TOOL_DEFINITIONS,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { model, messages };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama API error ${res.status}: ${text}`);
  }

  return (await res.json()) as ChatResponse;
}

async function describeImage(
  dataUrl: string,
  model: string,
): Promise<string> {
  log(`Describing image with vision model: ${model}`);

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Describe this wireframe/UI design in detail. Include layout structure, components, positioning, colors, and text content. Be specific enough that a developer could recreate it.",
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  const res = await chatCompletion(model, messages);
  return res.choices[0]?.message?.content || "Unable to describe image";
}

function parseToolCallArgs(
  args: string | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof args === "string") {
    return JSON.parse(args);
  }
  return args;
}

interface ParsedTextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const KNOWN_TOOLS = new Set(["Read", "Write", "Edit", "Bash"]);

// Extract tool calls from text when model doesn't use structured tool calling.
// Matches JSON objects like {"name": "Write", "arguments": {...}}
function extractToolCallsFromText(text: string): ParsedTextToolCall[] {
  const calls: ParsedTextToolCall[] = [];

  // Find all top-level JSON objects that look like tool calls
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed.name && KNOWN_TOOLS.has(parsed.name) && parsed.arguments) {
            calls.push({
              name: parsed.name,
              arguments:
                typeof parsed.arguments === "string"
                  ? JSON.parse(parsed.arguments)
                  : parsed.arguments,
            });
          }
        } catch {
          // Not valid JSON, skip
        }
        start = -1;
      }
    }
  }

  return calls;
}

export const ollamaBackend: AgentBackend = async function* (
  config: BackendConfig,
): AsyncGenerator<AgentEvent> {
  log(
    `Ollama config: model=${config.model}, turns=${config.maxTurns}, base=${OLLAMA_BASE_URL}`,
  );
  log(`CWD: ${config.projectDir}`);

  yield {
    type: "status",
    message: `Ollama: ${config.model}, max ${config.maxTurns} turns`,
  };

  // Handle images: extract, describe with vision model, inject description
  let prompt = config.prompt;
  const { text, images } = extractImages(prompt);

  if (images.length > 0) {
    yield {
      type: "status",
      message: `Describing ${images.length} image(s) with ${VISION_MODEL}...`,
    };

    const descriptions: string[] = [];
    for (const img of images) {
      const desc = await describeImage(img, VISION_MODEL);
      descriptions.push(desc);
    }

    prompt =
      text +
      "\n\n" +
      descriptions
        .map(
          (d, i) =>
            `[Image ${i + 1} description]:\n${d}`,
        )
        .join("\n\n");

    yield { type: "status", message: "Image analysis complete" };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: prompt },
  ];

  let turn = 0;

  while (turn < config.maxTurns) {
    turn++;
    log(`Turn ${turn}/${config.maxTurns}`);

    let response: ChatResponse;
    try {
      response = await chatCompletion(config.model, messages, TOOL_DEFINITIONS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", error: msg };
      return;
    }

    const choice = response.choices[0];
    if (!choice) {
      yield { type: "error", error: "No response from Ollama" };
      return;
    }

    const assistantMsg = choice.message;

    log(`Response: finish_reason=${choice.finish_reason}, has_content=${!!assistantMsg.content}, has_tool_calls=${!!assistantMsg.tool_calls}, tool_calls_count=${assistantMsg.tool_calls?.length ?? 0}`);

    // Check for structured tool calls first, then try extracting from text
    let toolCalls: ParsedTextToolCall[] = [];

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      // Structured tool calls from the API
      toolCalls = assistantMsg.tool_calls.map((tc) => ({
        name: tc.function.name,
        arguments: parseToolCallArgs(tc.function.arguments),
      }));
    } else if (assistantMsg.content) {
      // Try to extract tool calls from text content
      toolCalls = extractToolCallsFromText(assistantMsg.content);
      if (toolCalls.length > 0) {
        log(`Extracted ${toolCalls.length} tool call(s) from text`);
      }
    }

    // Emit any text content (only non-tool-call text)
    if (assistantMsg.content) {
      if (toolCalls.length === 0) {
        const preview = assistantMsg.content.slice(0, 200);
        log(`TEXT: ${preview}${assistantMsg.content.length > 200 ? "..." : ""}`);
        yield { type: "assistant", message: assistantMsg.content };
      } else {
        log(`TEXT (contains tool calls, suppressed from chat)`);
      }
    }

    // No tool calls — model is done
    if (toolCalls.length === 0) {
      log("No tool calls, agent complete");
      break;
    }

    // Append assistant message to conversation
    messages.push({
      role: "assistant",
      content: assistantMsg.content || "",
      ...(assistantMsg.tool_calls ? { tool_calls: assistantMsg.tool_calls } : {}),
    });

    // Execute each tool call
    const toolResults: string[] = [];
    for (const toolCall of toolCalls) {
      const detail =
        (toolCall.arguments.file_path as string) ||
        (toolCall.arguments.command as string) ||
        "";
      log(`TOOL: ${toolCall.name} ${detail}`);
      yield { type: "status", message: `${toolCall.name}: ${detail}`.trim() };

      const result = await executeTool(
        toolCall.name,
        toolCall.arguments,
        config.projectDir,
      );
      toolResults.push(`[${toolCall.name}]: ${result}`);
    }

    // Feed results back — for text-extracted calls, use a user message with results
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      // Structured: use proper tool result messages
      for (let i = 0; i < assistantMsg.tool_calls.length; i++) {
        messages.push({
          role: "tool",
          tool_call_id: assistantMsg.tool_calls[i].id,
          content: toolResults[i] || "Done",
        });
      }
    } else {
      // Text-extracted: feed results back as a user message
      messages.push({
        role: "user",
        content: `Tool results:\n${toolResults.join("\n\n")}`,
      });
    }
  }

  if (turn >= config.maxTurns) {
    log(`Reached max turns (${config.maxTurns})`);
  }

  yield {
    type: "usage",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  };

  yield { type: "complete", message: "Done" };

  log(`Ollama agent complete after ${turn} turns`);
};
