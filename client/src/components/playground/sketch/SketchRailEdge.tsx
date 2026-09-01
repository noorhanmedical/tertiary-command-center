// SketchRailEdge — a colored-pencil hand-drawn edge traced along ONE vertical
// side of its host (a rail body). Sits absolute + pointer-events-none over the
// host so it adds no width and causes no reflow; because it lives inside the
// rail's transforming container, it moves with peek/pin and disappears when the
// rail hides. Rough.js with a stable seed so it never jitters on re-render.
//
// This is NOT a card or a full box — it traces one edge (+ tiny corner turns)
// to subtly frame the Playground canvas.

import { useSketchCanvas } from "./useSketchCanvas";
import { sketchOptions, stableSeed, SKETCH_COLORS } from "./sketchTokens";

export function SketchRailEdge({
  side,
  seedId,
}: {
  /** Which vertical edge of the host to trace. */
  side: "left" | "right";
  seedId: string;
}) {
  const seed = stableSeed(`rail-edge:${seedId}:${side}`);

  const { containerRef, canvasRef } = useSketchCanvas({
    seed,
    deps: [side],
    draw: (rc, _ctx, size, s) => {
      const { width: w, height: h } = size;
      // X position of the traced edge (a couple px inset so the stroke sits
      // on the rail boundary, not clipped).
      const x = side === "right" ? w - 2.5 : 2.5;
      const top = 8;
      const bottom = h - 8;
      const cornerLen = 14;
      const inward = side === "right" ? -cornerLen : cornerLen;

      // Primary muted pencil-blue pass.
      rc.line(x, top, x, bottom, {
        ...sketchOptions("structural", "blue", { strokeWidth: 2 }),
        seed: s,
      });
      // Faint secondary graphite pass, slightly offset — the "two-pencil" feel.
      rc.line(x + (side === "right" ? -1.5 : 1.5), top + 6, x + (side === "right" ? -1.5 : 1.5), bottom - 6, {
        ...sketchOptions("structural", "graphiteLight", { strokeWidth: 1 }),
        seed: s + 1,
      });
      // Tiny hand-drawn corner turns (subtle, not a full box).
      rc.line(x, top, x + inward, top + 2, {
        ...sketchOptions("structural", "blue", { strokeWidth: 1.8 }),
        seed: s + 2,
      });
      rc.line(x, bottom, x + inward, bottom - 2, {
        ...sketchOptions("structural", "blue", { strokeWidth: 1.8 }),
        seed: s + 3,
      });
    },
  });

  return (
    <span
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{ color: SKETCH_COLORS.blue }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </span>
  );
}
