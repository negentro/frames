import { useCallback, useRef, useState } from "react";
import { api, streamFromAgent, type SSEEvent } from "../lib/api";

export interface GenerationStatus {
  phase: "idle" | "generating" | "complete" | "error";
  projectId: string | null;
  buildId: string | null;
  messages: string[];
  error: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}

const initialStatus: GenerationStatus = {
  phase: "idle",
  projectId: null,
  buildId: null,
  messages: [],
  error: null,
  usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
};

export function useGeneration() {
  const [status, setStatus] = useState<GenerationStatus>(initialStatus);
  const controllerRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback((event: SSEEvent) => {
    try {
      const data = JSON.parse(event.data);

      switch (event.event) {
        case "status": {
          const msg: string = data.message || event.data;
          // Only show high-level status messages, not tool calls
          const isFiltered =
            msg.startsWith("Write:") ||
            msg.startsWith("Read:") ||
            msg.startsWith("Edit:") ||
            msg.startsWith("Bash:") ||
            msg.startsWith("Ollama:") ||
            msg.startsWith("Describing");
          if (!isFiltered) {
            setStatus((prev) => ({
              ...prev,
              messages: [...prev.messages, msg],
            }));
          }
          break;
        }

        case "assistant":
          // Suppress model output from chat — only status messages shown
          break;

        case "usage":
          setStatus((prev) => ({
            ...prev,
            usage: {
              input_tokens:
                prev.usage.input_tokens + (data.input_tokens || 0),
              output_tokens:
                prev.usage.output_tokens + (data.output_tokens || 0),
              cost_usd: prev.usage.cost_usd + (data.cost_usd || 0),
            },
          }));
          break;

        case "complete":
          // Don't set phase here — let the onDone callback handle it
          // after the DB has been updated via api.generate.complete()
          break;

        case "error":
          setStatus((prev) => ({
            ...prev,
            phase: "error",
            error: data.error || "Unknown error",
          }));
          break;
      }
    } catch {
      setStatus((prev) => ({
        ...prev,
        messages: [...prev.messages, event.data],
      }));
    }
  }, []);

  // Start streaming from the agent. DB records must already exist.
  const startStream = useCallback(
    (
      projectId: string,
      buildId: string,
      agentEndpoint: string,
      agentBody: Record<string, unknown>,
    ) => {
      controllerRef.current = streamFromAgent(
        agentEndpoint,
        agentBody,
        handleEvent,
        async (err) => {
          setStatus((prev) => ({
            ...prev,
            phase: "error",
            error: err.message,
          }));
          await api.generate.error(projectId, buildId).catch(() => {});
        },
        async () => {
          // Read current state, notify API server, then set complete
          const currentStatus = await new Promise<GenerationStatus>(
            (resolve) => setStatus((prev) => { resolve(prev); return prev; }),
          );

          if (currentStatus.phase !== "error") {
            await api.generate
              .complete(projectId, buildId, currentStatus.usage)
              .catch(() => {});
            setStatus((prev) =>
              prev.phase !== "error"
                ? { ...prev, phase: "complete" }
                : prev,
            );
          }
        },
      );
    },
    [handleEvent],
  );

  // Initial generation — DB records already created by home page
  const generate = useCallback(
    (projectId: string, buildId: string, image: string) => {
      controllerRef.current?.abort();
      setStatus({
        ...initialStatus,
        phase: "generating",
        projectId,
        buildId,
      });

      startStream(projectId, buildId, "/generate", {
        projectId,
        buildId,
        image,
      });
    },
    [startStream],
  );

  // Iteration on existing project
  const iterate = useCallback(
    async (projectId: string, instruction: string, annotation?: string) => {
      controllerRef.current?.abort();
      setStatus((prev) => ({
        ...prev,
        phase: "generating",
        messages: [],
        error: null,
      }));

      try {
        const { buildId } = await api.generate.createIteration(
          projectId,
          instruction,
          annotation,
        );

        setStatus((prev) => ({ ...prev, buildId }));

        startStream(projectId, buildId, "/iterate", {
          projectId,
          buildId,
          instruction,
          annotation,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setStatus((prev) => ({ ...prev, phase: "error", error: msg }));
      }
    },
    [startStream],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setStatus((prev) => ({ ...prev, phase: "idle" }));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setStatus(initialStatus);
  }, []);

  return { status, generate, iterate, cancel, reset };
}
