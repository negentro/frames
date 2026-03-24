import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { api, getPreviewUrl, type ProjectDetail } from "../lib/api";
import { useGeneration } from "../hooks/use-generation";

interface ChatMessage {
  role: "user" | "system";
  content: string;
  timestamp: Date;
}

interface LocationState {
  image?: string;
  buildId?: string;
  autoGenerate?: boolean;
}

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const { status, generate, iterate } = useGeneration();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const generationStarted = useRef(false);

  // Fetch project data
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.projects
      .get(id)
      .then((p) => {
        setProject(p);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [id]);

  // Auto-start generation if navigated from home page with image
  useEffect(() => {
    if (
      !generationStarted.current &&
      locationState?.autoGenerate &&
      locationState?.image &&
      locationState?.buildId &&
      id
    ) {
      generationStarted.current = true;
      window.history.replaceState({}, document.title);
      generate(id, locationState.buildId, locationState.image);
    }
  }, [locationState, id, generate]);

  // Refetch project when generation completes
  useEffect(() => {
    if (status.phase === "complete" && id) {
      api.projects.get(id).then(setProject);
    }
  }, [status.phase, id]);

  // Add agent status messages to chat
  useEffect(() => {
    if (status.messages.length > 0) {
      const latest = status.messages.at(-1)!;
      setMessages((prev) => {
        if (
          prev.at(-1)?.content === latest &&
          prev.at(-1)?.role === "system"
        ) {
          return prev;
        }
        return [
          ...prev,
          { role: "system", content: latest, timestamp: new Date() },
        ];
      });
    }
  }, [status.messages]);

  // Add error to chat
  useEffect(() => {
    if (status.phase === "error" && status.error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${status.error}`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [status.phase, status.error]);

  // Add completion to chat
  useEffect(() => {
    if (status.phase === "complete") {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "Generation complete. Preview updated.",
          timestamp: new Date(),
        },
      ]);
    }
  }, [status.phase]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !id || status.phase === "generating") return;

    const instruction = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: instruction, timestamp: new Date() },
    ]);
    iterate(id, instruction);
  }, [input, id, status.phase, iterate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Determine latest build for preview
  const latestBuild = project?.builds?.find((b) => b.status === "ready");
  const previewUrl =
    latestBuild && id ? getPreviewUrl(id, latestBuild.id) : null;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-neutral-400">Project not found</p>
        <button
          className="text-sm text-blue-400 hover:underline"
          onClick={() => navigate("/")}
        >
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Preview Panel */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <button
            className="text-neutral-400 hover:text-white"
            onClick={() => navigate("/")}
          >
            &larr;
          </button>
          {status.phase === "generating" && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <div className="h-3 w-3 animate-spin rounded-full border border-neutral-600 border-t-white" />
              Building...
            </div>
          )}
        </div>

        <div className="flex-1 bg-neutral-950">
          {previewUrl ? (
            <iframe
              src={previewUrl}
              className="h-full w-full border-0"
              title="Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-neutral-600">
              {status.phase === "generating"
                ? "Building preview..."
                : "No preview available yet"}
            </div>
          )}
        </div>
      </div>

      {/* Chat Panel */}
      <div className="flex w-96 flex-col border-l border-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium font-mono">{id}</h2>
            <span className="text-xs text-neutral-500">
              {status.phase === "generating" ? "generating" : project.status}
            </span>
          </div>
        </div>

        {/* Usage */}
        {(project.usage?.total_cost_usd ?? 0) > 0 && (
          <div className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-500">
            Tokens:{" "}
            {(
              project.usage!.total_input_tokens +
              project.usage!.total_output_tokens
            ).toLocaleString()}
            {" · "}
            Cost: ${project.usage!.total_cost_usd.toFixed(4)}
          </div>
        )}

        {/* Live usage during generation */}
        {status.phase === "generating" && status.usage.cost_usd > 0 && (
          <div className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Tokens:{" "}
            {(
              status.usage.input_tokens + status.usage.output_tokens
            ).toLocaleString()}
            {" · "}
            Cost: ${status.usage.cost_usd.toFixed(4)}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
          {messages.length === 0 && status.phase !== "generating" && (
            <p className="text-sm text-neutral-500">
              Describe changes to iterate on your project.
            </p>
          )}
          {messages.length === 0 && status.phase === "generating" && (
            <p className="text-sm text-neutral-500">
              Generation in progress...
            </p>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              style={i > 0 ? { marginTop: 12 } : undefined}
              className={msg.role === "user" ? "text-right" : ""}
            >
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800/60 text-neutral-300"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-neutral-800 p-3">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              className="flex-1 resize-none rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:ring-1 focus:ring-neutral-600"
              placeholder="Describe changes..."
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={status.phase === "generating"}
            />
            <button
              className="self-end rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30"
              onClick={handleSend}
              disabled={!input.trim() || status.phase === "generating"}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
