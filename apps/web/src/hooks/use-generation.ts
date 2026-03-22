import { useCallback, useRef, useState } from "react";
import { streamGenerate, streamIterate, type SSEEvent } from "../lib/api";

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
        case "init":
          setStatus((prev) => ({
            ...prev,
            projectId: data.projectId,
            buildId: data.buildId,
          }));
          break;

        case "status":
          setStatus((prev) => ({
            ...prev,
            messages: [...prev.messages, data.message || event.data],
          }));
          break;

        case "usage":
          setStatus((prev) => ({
            ...prev,
            usage: {
              input_tokens: prev.usage.input_tokens + (data.input_tokens || 0),
              output_tokens: prev.usage.output_tokens + (data.output_tokens || 0),
              cost_usd: prev.usage.cost_usd + (data.cost_usd || 0),
            },
          }));
          break;

        case "complete":
          setStatus((prev) => ({
            ...prev,
            phase: "complete",
            projectId: data.projectId || prev.projectId,
            buildId: data.buildId || prev.buildId,
          }));
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
      // Non-JSON status message
      setStatus((prev) => ({
        ...prev,
        messages: [...prev.messages, event.data],
      }));
    }
  }, []);

  const handleError = useCallback((err: Error) => {
    setStatus((prev) => ({
      ...prev,
      phase: "error",
      error: err.message,
    }));
  }, []);

  const generate = useCallback(
    (image: string, name: string) => {
      controllerRef.current?.abort();
      setStatus({ ...initialStatus, phase: "generating" });
      controllerRef.current = streamGenerate(image, name, handleEvent, handleError);
    },
    [handleEvent, handleError]
  );

  const iterate = useCallback(
    (projectId: string, instruction: string, annotation?: string) => {
      controllerRef.current?.abort();
      setStatus((prev) => ({
        ...prev,
        phase: "generating",
        messages: [],
        error: null,
      }));
      controllerRef.current = streamIterate(projectId, instruction, annotation, handleEvent, handleError);
    },
    [handleEvent, handleError]
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
