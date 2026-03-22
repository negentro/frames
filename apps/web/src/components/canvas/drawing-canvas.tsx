import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDrawing,
  strokeToPath,
  type Point,
  type Stroke,
} from "./use-drawing";

interface DrawingCanvasProps {
  onExport: (dataUrl: string) => void;
  onCancel: () => void;
}

const COLORS = ["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];
const SIZES = [2, 4, 8, 16];

function StrokePath({ stroke }: { stroke: Stroke }) {
  const path = strokeToPath(stroke);
  if (stroke.isEraser) {
    return (
      <path
        d={path}
        fill="#0a0a0a"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    );
  }
  return (
    <path
      d={path}
      fill={stroke.color}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

export function DrawingCanvas({ onExport, onCancel }: DrawingCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const {
    state,
    undoneStrokes,
    options,
    setOptions,
    startStroke,
    addPoint,
    endStroke,
    undo,
    redo,
    clear,
  } = useDrawing();

  const [activeColor, setActiveColor] = useState(COLORS[0]);
  const [activeSize, setActiveSize] = useState(SIZES[1]);
  const [isEraser, setIsEraser] = useState(false);

  const getPoint = useCallback(
    (e: React.PointerEvent): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        pressure: e.pressure,
      };
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      startStroke(getPoint(e));
    },
    [getPoint, startStroke]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons !== 1) return;
      addPoint(getPoint(e));
    },
    [getPoint, addPoint]
  );

  const handlePointerUp = useCallback(() => {
    endStroke();
  }, [endStroke]);

  useEffect(() => {
    setOptions({ color: activeColor, size: activeSize, isEraser });
  }, [activeColor, activeSize, isEraser, setOptions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  const handleExport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const rect = svg.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);

    // Fill with the canvas background color
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const img = new Image();
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/png");
      onExport(dataUrl);
    };
    img.src = url;
  }, [onExport]);

  return (
    <div className="flex h-screen flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-6">
          {/* Tool toggle */}
          <div className="flex gap-1 rounded-lg bg-neutral-900 p-1">
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                !isEraser
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
              onClick={() => setIsEraser(false)}
            >
              Pen
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                isEraser
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
              onClick={() => setIsEraser(true)}
            >
              Eraser
            </button>
          </div>

          {/* Colors */}
          {!isEraser && (
            <div className="flex items-center gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    activeColor === color
                      ? "border-white scale-110"
                      : "border-transparent hover:border-neutral-500"
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setActiveColor(color)}
                />
              ))}
            </div>
          )}

          {/* Sizes */}
          <div className="flex items-center gap-2">
            {SIZES.map((size) => (
              <button
                key={size}
                className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                  activeSize === size
                    ? "bg-neutral-700"
                    : "hover:bg-neutral-800"
                }`}
                onClick={() => setActiveSize(size)}
              >
                <div
                  className="rounded-full bg-white"
                  style={{ width: size + 2, height: size + 2 }}
                />
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-1">
            <button
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
              onClick={undo}
              disabled={state.strokes.length === 0}
            >
              Undo
            </button>
            <button
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
              onClick={redo}
              disabled={undoneStrokes.length === 0}
            >
              Redo
            </button>
            <button
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
              onClick={clear}
              disabled={state.strokes.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Right side: cancel + generate */}
        <div className="flex items-center gap-3">
          <button
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 transition hover:text-white"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30"
            onClick={handleExport}
            disabled={state.strokes.length === 0}
          >
            Generate
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="h-full w-full touch-none"
          style={{ cursor: isEraser ? "crosshair" : "crosshair" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {state.strokes.map((stroke, i) => (
            <StrokePath key={i} stroke={stroke} />
          ))}
          {state.currentStroke && <StrokePath stroke={state.currentStroke} />}
        </svg>
      </div>
    </div>
  );
}
