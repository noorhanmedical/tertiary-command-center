// Playground Home Artwork — Rough.js bicycle illustration.
//
// Sits directly on the Playground canvas. No card, no panel, no container.
// Uses absolute positioning to center on the full available canvas area.
// Forced to bicycle for now until visual quality is confirmed.

import { useEffect, useRef } from "react";
import rough from "roughjs";

// ─── Graphite palette ─────────────────────────────────────────────────────

const INK = "#1F2937";
const DARK = "#374151";
const MID = "#475569";
const ACCENT = "#546A9A"; // muted pencil blue
const LIGHT = "#9CA3AF";

// ─── Bicycle drawing ──────────────────────────────────────────────────────

function drawBicycle(rc: ReturnType<typeof rough.canvas>, seed: number) {
  const s = seed;

  // Ground shadow (light hachure).
  rc.path("M 50 230 Q 180 240 320 230", {
    stroke: LIGHT, strokeWidth: 0.8, roughness: 2, fill: "none", seed: s,
  });
  rc.path("M 80 235 Q 180 242 280 235", {
    stroke: LIGHT, strokeWidth: 0.6, roughness: 2.2, fill: "none", seed: s + 1,
  });

  // ── Rear wheel ──
  rc.circle(100, 190, 90, {
    stroke: INK, strokeWidth: 2.2, roughness: 1.6, bowing: 1, fill: "none", seed: s + 2,
  });
  // Rear hub.
  rc.circle(100, 190, 10, {
    stroke: DARK, strokeWidth: 1.5, roughness: 1.4, fill: "none", seed: s + 3,
  });
  // Rear spokes (rough lines from hub to rim).
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.1;
    const x2 = 100 + Math.cos(angle) * 42;
    const y2 = 190 + Math.sin(angle) * 42;
    rc.line(100, 190, x2, y2, {
      stroke: MID, strokeWidth: 0.7, roughness: 1.8, seed: s + 10 + i,
    });
  }

  // ── Front wheel ──
  rc.circle(260, 190, 90, {
    stroke: INK, strokeWidth: 2.2, roughness: 1.6, bowing: 1, fill: "none", seed: s + 20,
  });
  // Front hub.
  rc.circle(260, 190, 10, {
    stroke: DARK, strokeWidth: 1.5, roughness: 1.4, fill: "none", seed: s + 21,
  });
  // Front spokes.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.3;
    const x2 = 260 + Math.cos(angle) * 42;
    const y2 = 190 + Math.sin(angle) * 42;
    rc.line(260, 190, x2, y2, {
      stroke: MID, strokeWidth: 0.7, roughness: 1.8, seed: s + 30 + i,
    });
  }

  // ── Frame ──
  // Seat tube.
  rc.line(140, 130, 100, 190, {
    stroke: INK, strokeWidth: 2.4, roughness: 1.5, bowing: 0.9, seed: s + 40,
  });
  // Top tube.
  rc.line(140, 130, 230, 135, {
    stroke: INK, strokeWidth: 2.2, roughness: 1.4, bowing: 0.8, seed: s + 41,
  });
  // Down tube.
  rc.line(230, 135, 100, 190, {
    stroke: INK, strokeWidth: 2.2, roughness: 1.5, bowing: 1, seed: s + 42,
  });
  // Chain stay.
  rc.line(100, 190, 165, 190, {
    stroke: DARK, strokeWidth: 1.8, roughness: 1.4, seed: s + 43,
  });
  // Seat stay.
  rc.line(100, 190, 140, 130, {
    stroke: DARK, strokeWidth: 1.6, roughness: 1.5, seed: s + 44,
  });

  // ── Fork ──
  rc.line(230, 135, 260, 190, {
    stroke: INK, strokeWidth: 2, roughness: 1.4, bowing: 0.8, seed: s + 50,
  });

  // ── Handlebar ──
  rc.path("M 218 120 Q 230 118 240 125 Q 248 130 232 135", {
    stroke: DARK, strokeWidth: 2, roughness: 1.6, fill: "none", seed: s + 51,
  });
  // Stem.
  rc.line(230, 135, 230, 122, {
    stroke: DARK, strokeWidth: 1.8, roughness: 1.3, seed: s + 52,
  });

  // ── Seat ──
  rc.path("M 130 125 Q 140 120 150 125", {
    stroke: INK, strokeWidth: 2.2, roughness: 1.5, fill: "none", seed: s + 53,
  });
  // Seat post.
  rc.line(140, 125, 140, 135, {
    stroke: DARK, strokeWidth: 1.8, roughness: 1.3, seed: s + 54,
  });

  // ── Crank / Pedals ──
  rc.circle(165, 190, 20, {
    stroke: DARK, strokeWidth: 1.8, roughness: 1.5, fill: "none", seed: s + 55,
  });
  // Crank arm.
  rc.line(165, 190, 175, 200, {
    stroke: INK, strokeWidth: 2, roughness: 1.4, seed: s + 56,
  });
  // Pedal.
  rc.rectangle(172, 198, 12, 5, {
    stroke: DARK, strokeWidth: 1.2, roughness: 1.6, fill: "none", seed: s + 57,
  });

  // ── Chain suggestion ──
  rc.path("M 110 195 Q 140 200 165 195", {
    stroke: MID, strokeWidth: 1, roughness: 1.8, fill: "none", seed: s + 58,
  });

  // ── Blue accent on frame ──
  rc.line(145, 132, 220, 135, {
    stroke: ACCENT, strokeWidth: 1.2, roughness: 1.3, seed: s + 60,
  });
}

// ─── Component ────────────────────────────────────────────────────────────

export function PlaygroundHomeArtwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawnRef.current) return;
    drawnRef.current = true;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rc = rough.canvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use today's date as seed for subtle daily variation.
    const today = new Date().toISOString().slice(0, 10);
    let seed = 0;
    for (let i = 0; i < today.length; i++) seed = ((seed << 5) - seed + today.charCodeAt(i)) | 0;
    seed = Math.abs(seed);

    drawBicycle(rc, seed);
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center pb-20"
      data-testid="playground-home-artwork"
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        width={360}
        height={260}
        className="max-w-[90vw]"
        style={{ width: 360, height: 260 }}
      />
    </div>
  );
}
