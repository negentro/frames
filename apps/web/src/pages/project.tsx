import { useParams } from "react-router";

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="flex h-screen">
      {/* Chat Panel */}
      <div className="flex w-80 flex-col border-r border-neutral-800 p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Chat
        </h2>
        <p className="text-sm text-neutral-500">
          Project {id} — chat panel placeholder
        </p>
      </div>

      {/* Preview Panel */}
      <div className="flex flex-1 flex-col border-r border-neutral-800 p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Preview
        </h2>
        <p className="text-sm text-neutral-500">Live preview placeholder</p>
      </div>

      {/* Canvas Panel */}
      <div className="flex w-96 flex-col p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Canvas
        </h2>
        <p className="text-sm text-neutral-500">Drawing canvas placeholder</p>
      </div>
    </div>
  );
}
