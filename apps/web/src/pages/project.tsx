import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { api, getPreviewUrl, undoOnAgent, type ProjectDetail } from "../lib/api";
import { useGeneration } from "../hooks/use-generation";

interface ChatMessage {
  role: "user" | "system";
  content: string;
  status: "pending" | "completed";
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
  const [undoing, setUndoing] = useState(false);

  const { status, generate, iterate } = useGeneration();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const generationStarted = useRef(false);

  // Fetch project data and load persisted messages
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.projects
      .get(id)
      .then((p) => {
        setProject(p);
        if (p.messages?.length > 0) {
          setMessages(
            p.messages.map((m) => ({
              role: m.role as "user" | "system",
              content: m.content,
              status: "completed" as const,
              timestamp: new Date(m.created_at),
            })),
          );
        }
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

  const addMessage = useCallback(
    (role: "user" | "system", content: string, msgStatus: "pending" | "completed" = "pending") => {
      setMessages((prev) => {
        if (prev.at(-1)?.content === content && prev.at(-1)?.role === role) {
          return prev;
        }
        // Mark all previous pending messages as completed
        const updated = prev.map((m) =>
          m.status === "pending" ? { ...m, status: "completed" as const } : m,
        );
        return [...updated, { role, content, status: msgStatus, timestamp: new Date() }];
      });
      if (id) {
        api.projects.addMessage(id, role, content).catch(() => {});
      }
    },
    [id],
  );

  // Add agent status messages to chat
  useEffect(() => {
    if (status.messages.length > 0) {
      const latest = status.messages.at(-1)!;
      addMessage("system", latest);
    }
  }, [status.messages, addMessage]);

  // Add error to chat
  useEffect(() => {
    if (status.phase === "error" && status.error) {
      addMessage("system", `Error: ${status.error}`);
    }
  }, [status.phase, status.error, addMessage]);

  // Mark all messages completed when generation finishes
  useEffect(() => {
    if (status.phase === "complete") {
      setMessages((prev) =>
        prev.map((m) =>
          m.status === "pending" ? { ...m, status: "completed" as const } : m,
        ),
      );
    }
  }, [status.phase]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !id || status.phase === "generating" || undoing) return;

    const instruction = input.trim();
    setInput("");
    addMessage("user", instruction);
    iterate(id, instruction);
  }, [input, id, status.phase, iterate, addMessage]);

  const canUndo =
    !undoing &&
    status.phase !== "generating" &&
    project &&
    (project.builds?.filter((b) => b.status === "ready").length ?? 0) >= 2;

  const handleUndo = useCallback(async () => {
    if (!id || !canUndo) return;
    setUndoing(true);

    try {
      // 1. Get the previous build ID and the undone message from API
      const result = await api.generate.undo(id);

      // 2. Revert git + rebuild + upload on agent server
      await undoOnAgent(id, result.previousBuildId);

      // 3. Put the undone message back in the input
      if (result.undoneMessage) {
        setInput(result.undoneMessage);
      }

      // 4. Remove the last user + system messages from local state
      setMessages((prev) => {
        // Find the last user message index
        let lastUserIdx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "user") {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx === -1) return prev;
        // Remove everything from that user message onwards
        return prev.slice(0, lastUserIdx);
      });

      // 5. Refetch project to get updated builds
      const updated = await api.projects.get(id);
      setProject(updated);
    } catch (err) {
      console.error("Undo failed:", err);
    } finally {
      setUndoing(false);
    }
  }, [id, canUndo]);

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
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-4">
          <button
            className="text-neutral-400 hover:text-white"
            onClick={() => navigate("/")}
          >
            &larr;
          </button>
          {canUndo && (
            <button
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30"
              onClick={handleUndo}
              disabled={undoing}
            >
              <span>{undoing ? "Undoing" : "Undo"}</span>
              <svg
                className={`h-3.5 w-3.5 ${undoing ? "animate-spin" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
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
              Preview Unavailable
            </div>
          )}
        </div>
      </div>

      {/* Chat Panel */}
      <div className="flex w-96 flex-col border-l border-neutral-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-xs font-medium font-mono truncate">{id}</h2>
            <span className="text-[10px] text-neutral-500">
              {new Date(project.created_at).toLocaleString()}
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
          {messages.map((msg, i) => (
            <div
              key={i}
              style={i > 0 ? { marginTop: 12 } : undefined}
              className={msg.role === "user" ? "flex justify-end" : ""}
            >
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800/60 text-neutral-300"
                }`}
              >
                <div>{msg.content}</div>
                {msg.role === "system" && msg.status && (
                  <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[11px] text-neutral-500">
                    {msg.status === "pending" ? (
                      <>
                        <span>pending</span>
                        <div className="h-3 w-3 animate-spin rounded-full border border-neutral-600 border-t-neutral-400" />
                      </>
                    ) : (
                      <>
                        <span>completed</span>
                        <svg
                          className="h-3 w-3 text-neutral-400"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 8.5l4 4L14 3.5" />
                        </svg>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-neutral-800 p-4">
          <div className="rounded-lg bg-neutral-900 focus-within:ring-1 focus-within:ring-neutral-600">
            <textarea
              ref={inputRef}
              className="w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm text-white placeholder-neutral-500 outline-none"
              placeholder="Describe changes..."
              rows={2}
              value={input}
              onChange={(e) => {
                if (e.target.value.length <= 500) setInput(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              disabled={status.phase === "generating" || undoing}
              maxLength={500}
            />
            <div className="flex items-center justify-end gap-2 px-2 pb-2">
              <span className={`text-xs ${input.length > 450 ? "text-amber-400" : "text-neutral-600"}`}>
                {input.length}/500
              </span>
              <button
                className="rounded-md bg-white px-3 py-1 text-xs font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30"
                onClick={handleSend}
                disabled={!input.trim() || status.phase === "generating" || undoing}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
