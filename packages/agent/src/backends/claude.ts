import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentBackend, BackendConfig } from "./types.js";
import type { AgentEvent } from "../agent.js";

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function summarizeMessage(msg: SDKMessage): string {
  const base = `type=${msg.type}`;
  if ("subtype" in msg && msg.subtype) return `${base} subtype=${msg.subtype}`;
  if (msg.type === "assistant" && msg.message?.content) {
    const content = msg.message.content as Array<{
      type: string;
      name?: string;
    }>;
    const types = content
      .map((b) => (b.name ? `${b.type}(${b.name})` : b.type))
      .join(", ");
    return `${base} blocks=[${types}]`;
  }
  return base;
}

export const claudeBackend: AgentBackend = async function* (
  config: BackendConfig,
): AsyncGenerator<AgentEvent> {
  let sessionId: string | undefined;

  log(
    `Config: budget=$${config.maxBudgetUsd}, turns=${config.maxTurns}, model=${config.model}`,
  );
  log(`CWD: ${config.projectDir}`);

  yield {
    type: "status",
    message: `Budget: $${(config.maxBudgetUsd ?? 0).toFixed(2)}, max ${config.maxTurns} turns`,
  };

  log(`Using model: ${config.model}, iteration: ${config.isIteration}`);

  const q = query({
    prompt: config.prompt,
    options: {
      cwd: config.projectDir,
      model: config.model,
      systemPrompt: config.systemPrompt,
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      // Limit thinking tokens to control cost — iterations need less reasoning
      maxThinkingTokens: config.isIteration ? 4096 : 8192,
    },
  });

  log("query() created, entering message loop...");

  let messageCount = 0;
  for await (const msg of q) {
    messageCount++;
    log(`MSG #${messageCount}: ${summarizeMessage(msg)}`);

    if (
      msg.type === "system" &&
      "subtype" in msg &&
      msg.subtype === "init"
    ) {
      sessionId = msg.session_id;
      yield { type: "status", message: "Agent initialized", sessionId };
      continue;
    }

    if (msg.type === "assistant" && msg.message?.content) {
      const content = msg.message.content as Array<{
        type: string;
        name?: string;
        text?: string;
        input?: { file_path?: string; command?: string };
      }>;

      for (const block of content) {
        if (block.type === "tool_use" && block.name) {
          const detail =
            block.input?.file_path || block.input?.command || "";
          log(`  TOOL: ${block.name} ${detail}`);
          yield {
            type: "status",
            message: `${block.name}: ${detail}`.trim(),
          };
        }
        if (block.type === "text" && block.text) {
          const preview = block.text.slice(0, 120);
          log(
            `  TEXT: ${preview}${block.text.length > 120 ? "..." : ""}`,
          );
          yield { type: "assistant", message: block.text };
        }
      }
      continue;
    }

    if (msg.type === "user") {
      log(`  (tool result / synthetic user message)`);
      continue;
    }

    if (msg.type === "result") {
      log(
        `RESULT: subtype=${msg.subtype}, cost=$${msg.total_cost_usd}, turns=${msg.num_turns}`,
      );
      log(
        `  tokens: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`,
      );

      yield {
        type: "usage",
        input_tokens: msg.usage.input_tokens,
        output_tokens: msg.usage.output_tokens,
        cost_usd: msg.total_cost_usd,
      };

      if (msg.subtype === "success") {
        yield { type: "complete", message: msg.result, sessionId };
      } else {
        const errors =
          "errors" in msg ? (msg as { errors: string[] }).errors : [];
        yield {
          type: "error",
          error:
            errors.length > 0
              ? errors.join("; ")
              : `Agent stopped: ${msg.subtype}`,
        };
      }
      continue;
    }

    log(`  (unhandled message type: ${msg.type})`);
  }

  log(`Message loop ended. Total messages: ${messageCount}`);
};
