import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";

export function HomePage() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setCreating(true);
      setError(null);

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const name = `Project ${new Date().toLocaleString()}`;
          const { projectId, buildId } = await api.generate.create(name, dataUrl);
          navigate(`/project/${projectId}`, {
            state: { image: dataUrl, buildId, autoGenerate: true },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to create project";
          setError(msg);
          setCreating(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [navigate],
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-5xl font-bold tracking-tight">Eigen</h1>
      <p className="text-lg text-neutral-400">
        Transform wireframes into production UI
      </p>
      <button
        className="rounded-lg bg-white px-6 py-3 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50"
        onClick={() => fileInputRef.current?.click()}
        disabled={creating}
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

      {creating && (
        <div className="flex items-center gap-3 text-sm text-neutral-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
          <span>Creating project...</span>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
