// useSketchCanvas — draw stable Rough.js geometry into an absolutely-positioned
// <canvas> that tracks its parent's size via ResizeObserver.
//
// Primitives use this to render a hand-drawn border/fill behind clean HTML
// content. Geometry only recomputes when the box size or seed changes — never
// on unrelated re-renders — satisfying the Playground performance contract.

import { useEffect, useRef } from "react";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";

export type SketchDrawFn = (
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  seed: number,
) => void;

interface UseSketchCanvasArgs {
  draw: SketchDrawFn;
  seed: number;
  /** Re-draw when any of these change (in addition to size + seed). */
  deps?: ReadonlyArray<unknown>;
}

export function useSketchCanvas({ draw, seed, deps = [] }: UseSketchCanvasArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let frame = 0;

    const render = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const rc = rough.canvas(canvas);
      drawRef.current(rc, ctx, { width, height }, seed);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, ...deps]);

  return { containerRef, canvasRef };
}
