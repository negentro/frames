import { useCallback, useRef, useState } from "react";
import getStroke from "perfect-freehand";

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  size: number;
  isEraser: boolean;
}

export interface DrawingState {
  strokes: Stroke[];
  currentStroke: Stroke | null;
}

export interface DrawingOptions {
  color: string;
  size: number;
  isEraser: boolean;
}

function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return "";

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );

  d.push("Z");
  return d.join(" ");
}

export function strokeToPath(stroke: Stroke): string {
  const outlinePoints = getStroke(stroke.points, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  return getSvgPathFromStroke(outlinePoints);
}

export function useDrawing() {
  const [state, setState] = useState<DrawingState>({
    strokes: [],
    currentStroke: null,
  });
  const [undoneStrokes, setUndoneStrokes] = useState<Stroke[]>([]);
  const optionsRef = useRef<DrawingOptions>({
    color: "#ffffff",
    size: 4,
    isEraser: false,
  });

  const setOptions = useCallback((opts: Partial<DrawingOptions>) => {
    optionsRef.current = { ...optionsRef.current, ...opts };
  }, []);

  const startStroke = useCallback((point: Point) => {
    const opts = optionsRef.current;
    setState((prev) => ({
      ...prev,
      currentStroke: {
        points: [point],
        color: opts.isEraser ? "eraser" : opts.color,
        size: opts.isEraser ? opts.size * 3 : opts.size,
        isEraser: opts.isEraser,
      },
    }));
    setUndoneStrokes([]);
  }, []);

  const addPoint = useCallback((point: Point) => {
    setState((prev) => {
      if (!prev.currentStroke) return prev;
      return {
        ...prev,
        currentStroke: {
          ...prev.currentStroke,
          points: [...prev.currentStroke.points, point],
        },
      };
    });
  }, []);

  const endStroke = useCallback(() => {
    setState((prev) => {
      if (!prev.currentStroke) return prev;
      return {
        strokes: [...prev.strokes, prev.currentStroke],
        currentStroke: null,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.strokes.length === 0) return prev;
      const last = prev.strokes[prev.strokes.length - 1];
      setUndoneStrokes((u) => [...u, last]);
      return {
        ...prev,
        strokes: prev.strokes.slice(0, -1),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setUndoneStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setState((s) => ({
        ...s,
        strokes: [...s.strokes, last],
      }));
      return prev.slice(0, -1);
    });
  }, []);

  const clear = useCallback(() => {
    setState({ strokes: [], currentStroke: null });
    setUndoneStrokes([]);
  }, []);

  return {
    state,
    undoneStrokes,
    options: optionsRef,
    setOptions,
    startStroke,
    addPoint,
    endStroke,
    undo,
    redo,
    clear,
  };
}
