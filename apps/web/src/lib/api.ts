const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed: ${res.status}`);
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

export interface ProjectDetail extends Project {
  builds: Build[];
  usage: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  } | null;
}

export const api = {
  projects: {
    list: () => request<{ projects: Project[]; total: number }>("/api/projects"),
    get: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
    create: (name: string) => request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
    delete: (id: string) => request<{ id: string; deleted: boolean }>(`/api/projects/${id}`, {
      method: "DELETE",
    }),
  },
};

export type SSEEvent = {
  event: string;
  data: string;
};

export function streamGenerate(
  image: string,
  name: string,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, image }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        throw new Error(`Generate failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
    })
    .catch((err) => {
      if (err instanceof Error && err.name !== "AbortError") {
        onError(err);
      }
    });

  return controller;
}

export function streamIterate(
  projectId: string,
  instruction: string,
  annotation: string | undefined,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/generate/${projectId}/iterate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, annotation }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        throw new Error(`Iterate failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
    })
    .catch((err) => {
      if (err instanceof Error && err.name !== "AbortError") {
        onError(err);
      }
    });

  return controller;
}

export function getPreviewUrl(projectId: string, buildId: string): string {
  return `${API_BASE}/api/preview/${projectId}/builds/${buildId}/`;
}
