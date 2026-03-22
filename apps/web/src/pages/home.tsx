import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { DrawingCanvas } from "../components/canvas/drawing-canvas";

type Mode = "landing" | "drawing";

export function HomePage() {
  const [mode, setMode] = useState<Mode>("landing");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleDrawingExport = useCallback(
    (dataUrl: string) => {
      // TODO: POST to /api/generate with the image, get back a project ID,
      // then navigate to /project/:id
      console.log("Exported drawing, length:", dataUrl.length);
      navigate("/project/demo");
    },
    [navigate]
  );

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // TODO: POST to /api/generate with the image, get back a project ID,
        // then navigate to /project/:id
        console.log("Uploaded image, length:", dataUrl.length);
        navigate("/project/demo");
      };
      reader.readAsDataURL(file);
    },
    [navigate]
  );

  if (mode === "drawing") {
    return (
      <DrawingCanvas
        onExport={handleDrawingExport}
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
          className="rounded-lg bg-white px-6 py-3 font-medium text-black transition hover:bg-neutral-200"
          onClick={() => setMode("drawing")}
        >
          New from Drawing
        </button>
        <button
          className="rounded-lg border border-neutral-600 px-6 py-3 font-medium transition hover:border-neutral-400"
          onClick={() => fileInputRef.current?.click()}
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
    </div>
  );
}
