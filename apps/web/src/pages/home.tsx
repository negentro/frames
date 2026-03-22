import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DrawingCanvas } from "../components/canvas/drawing-canvas";
import { useGeneration } from "../hooks/use-generation";

type Mode = "landing" | "drawing";

export function HomePage() {
  const [mode, setMode] = useState<Mode>("landing");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { status, generate } = useGeneration();

  const startGeneration = useCallback(
    (dataUrl: string) => {
      const name = `Project ${new Date().toLocaleString()}`;
      generate(dataUrl, name);
    },
    [generate]
  );

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        startGeneration(reader.result as string);
      };
      reader.readAsDataURL(file);
    },
    [startGeneration]
  );

  // Navigate to project page once we have a project ID
  useEffect(() => {
    if (status.projectId && (status.phase === "generating" || status.phase === "complete")) {
      navigate(`/project/${status.projectId}`);
    }
  }, [status.projectId, status.phase, navigate]);

  if (mode === "drawing") {
    return (
      <DrawingCanvas
        onExport={startGeneration}
        onCancel={() => setMode("landing")}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-5xl font-bold tracking-tight">Eigen</h1>
      <p className="text-lg text-neutral-400">
        Transform drawings and wireframes into production UI
      </p>
      <div className="flex gap-4">
        <button
          className="rounded-lg bg-white px-6 py-3 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50"
          onClick={() => setMode("drawing")}
          disabled={status.phase === "generating"}
        >
          New from Drawing
        </button>
        <button
          className="rounded-lg border border-neutral-600 px-6 py-3 font-medium transition hover:border-neutral-400 disabled:opacity-50"
          onClick={() => fileInputRef.current?.click()}
          disabled={status.phase === "generating"}
        >
          Upload Wireframe
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {status.phase === "generating" && (
        <div className="flex items-center gap-3 text-sm text-neutral-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          <span>{status.messages.at(-1) || "Starting generation..."}</span>
        </div>
      )}

      {status.phase === "error" && (
        <p className="text-sm text-red-400">{status.error}</p>
      )}
    </div>
  );
}
