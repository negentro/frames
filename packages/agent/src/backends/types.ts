import type { AgentEvent } from "../agent.js";

export interface BackendConfig {
  projectDir: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  isIteration: boolean;
}

export type AgentBackend = (
  config: BackendConfig,
) => AsyncGenerator<AgentEvent>;
