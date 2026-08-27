// SketchSelect — a paper-white select with a rough graphite border, for the
// Playground-owned page header (Viewing as / Clinic / etc.). Backed by a native
// <select> so keyboard + screen-reader behavior is correct by default; the
// hand-drawn shell is a canvas overlay. Clean Inter text, blue-pencil focus.
//
// Use for Playground-owned header dropdowns. Shell/global chrome selectors stay
// Liquid Glass.

import { forwardRef, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSketchCanvas } from "./useSketchCanvas";
import { sketchOptions, stableSeed, SKETCH_COLORS } from "./sketchTokens";
import type { RoughCanvas } from "roughjs/bin/canvas";

export interface SketchSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  seedId?: string;
  /** Optional leading label rendered inline before the control. */
  containerClassName?: string;
}

export const SketchSelect = forwardRef<HTMLSelectElement, SketchSelectProps>(
  ({ seedId, className, containerClassName, children, ...rest }, ref) => {
    const seed = useMemo(
      () => stableSeed(`select:${seedId ?? rest.name ?? "select"}`),
      [seedId, rest.name],
    );

    const { containerRef, canvasRef } = useSketchCanvas({
      seed,
      draw: (rc: RoughCanvas, _ctx, size, s) => {
        drawRoughRoundedRect(rc, size.width, size.height, 8, {
          ...sketchOptions("structural", "graphite", { strokeWidth: 1.6 }),
          seed: s,
        });
      },
    });

    return (
      <div
        ref={containerRef}
        className={cn("relative inline-flex items-center", containerClassName)}
        style={{ backgroundColor: SKETCH_COLORS.paper, borderRadius: 8 }}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
        <select
          ref={ref}
          className={cn(
            "relative z-10 appearance-none bg-transparent py-1.5 pl-3 pr-8 text-[13px] text-slate-800",
            "outline-none cursor-pointer",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)] focus-visible:rounded-md",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 z-10 h-3.5 w-3.5 text-slate-500" />
      </div>
    );
  },
);
SketchSelect.displayName = "SketchSelect";

// Local copy of the rounded-rect tracer (kept private to avoid a cross-module
// export churn; identical to the one in SketchPrimitives).
function drawRoughRoundedRect(
  rc: RoughCanvas,
  w: number,
  h: number,
  r: number,
  options: Parameters<RoughCanvas["path"]>[1],
) {
  const inset = 1.5;
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const d = [
    `M ${x0 + rr} ${y0}`,
    `L ${x1 - rr} ${y0}`,
    `Q ${x1} ${y0} ${x1} ${y0 + rr}`,
    `L ${x1} ${y1 - rr}`,
    `Q ${x1} ${y1} ${x1 - rr} ${y1}`,
    `L ${x0 + rr} ${y1}`,
    `Q ${x0} ${y1} ${x0} ${y1 - rr}`,
    `L ${x0} ${y0 + rr}`,
    `Q ${x0} ${y0} ${x0 + rr} ${y0}`,
    "Z",
  ].join(" ");
  rc.path(d, options);
}
