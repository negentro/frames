const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8788";
const AGENT_BASE = import.meta.env.VITE_AGENT_URL || "http://localhost:8787";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error || `Request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export interface Project {
  id: string;
  name: string;
  status: "pending" | "generating" | "ready" | "error";
  created_at: string;
  updated_at: string;
}

export interface Build {
  id: string;
  project_id: string;
  status: "pending" | "building" | "ready" | "error";
  r2_prefix: string | null;
  created_at: string;
}

export interface ProjectMessage {
  role: string;
  content: string;
  created_at: string;
}

export interface ProjectDetail extends Project {
  builds: Build[];
  usage: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  } | null;
  messages: ProjectMessage[];
}

export const api = {
  projects: {
    list: () =>
      request<{ projects: Project[]; total: number }>("/api/projects"),
    get: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
    create: (name: string) =>
      request<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    delete: (id: string) =>
      request<{ id: string; deleted: boolean }>(`/api/projects/${id}`, {
        method: "DELETE",
      }),
    addMessage: (id: string, role: string, content: string) =>
      request<{ ok: boolean }>(`/api/projects/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ role, content }),
      }),
  },
  generate: {
    create: (name: string) =>
      request<{ projectId: string; buildId: string }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    createIteration: (projectId: string, instruction: string, annotation?: string) =>
      request<{ projectId: string; buildId: string }>(
        `/api/generate/${projectId}/iterate`,
        {
          method: "POST",
          body: JSON.stringify({ instruction, annotation }),
        },
      ),
    complete: (
      projectId: string,
      buildId: string,
      usage?: { input_tokens: number; output_tokens: number; cost_usd: number },
    ) =>
      request<{ ok: boolean }>(`/api/generate/${projectId}/complete`, {
        method: "POST",
        body: JSON.stringify({ buildId, usage }),
      }),
    error: (projectId: string, buildId: string) =>
      request<{ ok: boolean }>(`/api/generate/${projectId}/error`, {
        method: "POST",
        body: JSON.stringify({ buildId }),
      }),
  },
};

export type SSEEvent = {
  event: string;
  data: string;
};

function readSSEStream(
  res: Response,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    if (!res.body) {
      reject(new Error("No response body"));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "message";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            onEvent({ event: currentEvent, data: line.slice(6) });
            currentEvent = "message";
          }
        }
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

// Stream directly from the agent server
export function streamFromAgent(
  endpoint: string,
  body: Record<string, unknown>,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${AGENT_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Agent request failed: ${res.status}`);
      }
      await readSSEStream(res, onEvent);
      onDone();
    })
    .catch((err) => {
      if (err instanceof Error && err.name !== "AbortError") {
        onError(err);
      }
    });

  return controller;
}

export function getPreviewUrl(projectId: string, buildId: string): string {
  // Serve directly from agent server — the API server proxy has issues in wrangler dev
  // buildId as query param forces iframe reload on new builds
  return `${AGENT_BASE}/builds/${projectId}/?b=${buildId}`;
}
