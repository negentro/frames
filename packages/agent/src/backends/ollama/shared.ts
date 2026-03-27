export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "qwen2.5vl";

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string | Record<string, unknown> };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: ToolCall[] };
    finish_reason: string;
  }>;
}

export interface ParsedTextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// Match markdown image syntax: ![alt](data:image/...;base64,...)
const IMAGE_PATTERN = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;

export function extractImages(prompt: string): {
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

const MAX_EMPTY_RETRIES = 2;

export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  tools?: Array<Record<string, unknown>>,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { model, messages };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  for (let attempt = 1; attempt <= MAX_EMPTY_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min timeout

    const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const json = await res.json() as unknown as Record<string, unknown>;
    const choices = (json as unknown as ChatResponse).choices;

    // qwen3 puts thinking in "reasoning" field and may leave "content" empty
    const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = (msg?.content as string) || "";
    const reasoning = (msg?.reasoning as string) || "";
    const hasToolCalls = msg?.tool_calls && (msg.tool_calls as unknown[]).length > 0;

    if (!content && !hasToolCalls) {
      if (reasoning) {
        log(`LLM: content empty, reasoning=${reasoning.length} chars (qwen3 thinking mode?) — attempt ${attempt}/${MAX_EMPTY_RETRIES}`);
      } else {
        log(`LLM: empty response — attempt ${attempt}/${MAX_EMPTY_RETRIES}`);
      }
      if (attempt < MAX_EMPTY_RETRIES) {
        log("Retrying due to empty response...");
        continue;
      }
      log("LLM returned empty after all retries");
    } else if (content) {
      log(`LLM: content=${content.length} chars`);
    }

    return json as unknown as ChatResponse;
  }

  // Should not reach here, but satisfy TypeScript
  throw new Error("chatCompletion: exhausted retries with no response");
}

export async function describeImage(
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

// Extract tool calls from text when model doesn't use structured tool calling.
export function extractToolCallsFromText(
  text: string,
  knownTools: Set<string>,
): ParsedTextToolCall[] {
  const cleaned = stripThinkTags(text);
  const calls: ParsedTextToolCall[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed.name && knownTools.has(parsed.name) && parsed.arguments) {
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

// Strip <think>...</think> reasoning tags from model output
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// Strip markdown code fences and leaked XML tags from model output
export function stripCodeFences(text: string): string {
  let trimmed = stripThinkTags(text).trim();
  // Strip leaked <file_content> tags (from prompt injection mitigation)
  trimmed = trimmed.replace(/^<file_content[^>]*>\n?/, "").replace(/\n?<\/file_content>$/, "").trim();
  const match = trimmed.match(/^```\w*\n?([\s\S]*?)```$/);
  if (match) return match[1].trim();
  return trimmed;
}

// Extract JSON from text that may contain surrounding prose
export function extractJSON(text: string): string | null {
  const stripped = stripCodeFences(stripThinkTags(text));
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    // Look for JSON object in the text
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const candidate = stripped.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return null;
      }
    }
    return null;
  }
}
