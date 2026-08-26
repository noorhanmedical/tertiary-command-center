// Playground Home — Rough.js daily sketch artwork.
//
// High-quality hand-drawn illustrations generated with Rough.js.
// One per day (deterministic). Seasonal pools. No words. No cards.
// Sits directly on the Playground canvas.

import { useEffect, useMemo, useRef } from "react";
import rough from "roughjs";

// ─── Daily artwork definitions ────────────────────────────────────────────

type ArtworkDef = {
  id: string;
  season?: "winter" | "spring" | "summer" | "fall";
  draw: (rc: ReturnType<typeof rough.canvas>, ctx: CanvasRenderingContext2D, seed: number) => void;
};

// Graphite palette.
const INK = "#1F2937";
const DARK = "#374151";
const MID = "#4B5563";
const LIGHT = "#9CA3AF";

const ARTWORK_LIBRARY: ArtworkDef[] = [
  {
    id: "paper-airplane-jet",
    draw: (rc, ctx, seed) => {
      // Large paper airplane (top).
      rc.path("M 60 40 L 280 100 L 160 120 Z", {
        stroke: INK, strokeWidth: 2.2, roughness: 1.8, bowing: 1.2, fill: "none",
        seed,
      });
      rc.path("M 160 120 L 140 180 L 200 140", {
        stroke: DARK, strokeWidth: 1.8, roughness: 1.5, bowing: 1, fill: "none",
        seed: seed + 1,
      });
      rc.path("M 280 100 L 160 120 L 140 180", {
        stroke: MID, strokeWidth: 1.2, roughness: 1.3, bowing: 0.8,
        fill: "hachure", fillStyle: "hachure", hachureGap: 5, hachureAngle: -35,
        fillWeight: 0.6, seed: seed + 2,
      });
      // Small motion lines behind airplane.
      rc.line(30, 55, 50, 48, { stroke: LIGHT, strokeWidth: 1, roughness: 2, seed: seed + 3 });
      rc.line(25, 70, 48, 62, { stroke: LIGHT, strokeWidth: 0.8, roughness: 2.2, seed: seed + 4 });

      // Passenger jet silhouette (bottom, smaller).
      rc.path("M 80 240 L 120 230 L 260 230 L 280 240 L 260 250 L 120 250 Z", {
        stroke: DARK, strokeWidth: 1.5, roughness: 1.6, bowing: 1,
        fill: "hachure", fillStyle: "hachure", hachureGap: 4, hachureAngle: -25,
        fillWeight: 0.5, seed: seed + 5,
      });
      // Tail fin.
      rc.path("M 100 230 L 85 210 L 100 215 L 110 230", {
        stroke: DARK, strokeWidth: 1.3, roughness: 1.5, fill: "none", seed: seed + 6,
      });
      // Wing.
      rc.path("M 150 240 L 130 270 L 200 255 L 200 240", {
        stroke: MID, strokeWidth: 1.2, roughness: 1.4, fill: "none", seed: seed + 7,
      });
      // Engine.
      rc.ellipse(160, 255, 18, 10, {
        stroke: MID, strokeWidth: 1, roughness: 1.5, fill: "none", seed: seed + 8,
      });
    },
  },
  {
    id: "snowy-cabin-pines",
    season: "winter",
    draw: (rc, ctx, seed) => {
      // Cabin.
      rc.path("M 100 180 L 170 130 L 240 180", {
        stroke: INK, strokeWidth: 2, roughness: 1.6, bowing: 1.2, fill: "none", seed,
      });
      rc.rectangle(110, 180, 120, 70, {
        stroke: INK, strokeWidth: 1.8, roughness: 1.5,
        fill: "hachure", fillStyle: "hachure", hachureGap: 6, hachureAngle: -30,
        fillWeight: 0.5, seed: seed + 1,
      });
      // Door.
      rc.rectangle(155, 210, 25, 40, { stroke: DARK, strokeWidth: 1.3, roughness: 1.4, fill: "none", seed: seed + 2 });
      // Window.
      rc.rectangle(120, 195, 20, 18, { stroke: DARK, strokeWidth: 1, roughness: 1.5, fill: "none", seed: seed + 3 });
      // Chimney with smoke.
      rc.rectangle(205, 140, 12, 35, { stroke: DARK, strokeWidth: 1.2, roughness: 1.4, fill: "none", seed: seed + 4 });
      rc.path("M 208 140 Q 212 125 206 110 Q 215 95 210 80", {
        stroke: LIGHT, strokeWidth: 0.9, roughness: 2, fill: "none", seed: seed + 5,
      });
      // Pine trees.
      const drawPine = (x: number, h: number, s: number) => {
        rc.path(`M ${x} ${250 - h} L ${x - h * 0.4} 250 L ${x + h * 0.4} 250 Z`, {
          stroke: DARK, strokeWidth: 1.3, roughness: 1.5,
          fill: "hachure", fillStyle: "hachure", hachureGap: 5, hachureAngle: -40,
          fillWeight: 0.4, seed: s,
        });
      };
      drawPine(55, 80, seed + 6);
      drawPine(280, 65, seed + 7);
      drawPine(300, 50, seed + 8);
      // Snow ground.
      rc.path("M 20 250 Q 80 245 170 250 Q 250 255 340 250", {
        stroke: LIGHT, strokeWidth: 1, roughness: 2, fill: "none", seed: seed + 9,
      });
    },
  },
  {
    id: "notebook-pencil",
    draw: (rc, ctx, seed) => {
      // Notebook.
      rc.rectangle(70, 60, 140, 190, {
        stroke: INK, strokeWidth: 2, roughness: 1.5, bowing: 1,
        fill: "none", seed,
      });
      // Spiral binding.
      for (let i = 0; i < 8; i++) {
        rc.circle(70, 80 + i * 22, 8, {
          stroke: DARK, strokeWidth: 1, roughness: 1.8, fill: "none", seed: seed + 1 + i,
        });
      }
      // Faint ruled lines.
      for (let i = 0; i < 7; i++) {
        rc.line(85, 90 + i * 24, 195, 90 + i * 24, {
          stroke: LIGHT, strokeWidth: 0.5, roughness: 1.2, seed: seed + 10 + i,
        });
      }
      // Pencil (angled).
      rc.path("M 240 50 L 255 250 L 260 250 L 245 50 Z", {
        stroke: DARK, strokeWidth: 1.5, roughness: 1.4,
        fill: "hachure", fillStyle: "hachure", hachureGap: 4, hachureAngle: -10,
        fillWeight: 0.4, seed: seed + 20,
      });
      // Pencil tip.
      rc.path("M 247 250 L 250 270 L 253 250", {
        stroke: INK, strokeWidth: 1.3, roughness: 1.2, fill: "none", seed: seed + 21,
      });
      // Eraser.
      rc.rectangle(239, 45, 18, 12, {
        stroke: MID, strokeWidth: 1, roughness: 1.5, fill: "none", seed: seed + 22,
      });
    },
  },
  {
    id: "telescope-moon",
    draw: (rc, ctx, seed) => {
      // Telescope.
      rc.path("M 80 250 L 100 240 L 170 120 L 185 125 L 115 245 L 130 250", {
        stroke: INK, strokeWidth: 1.8, roughness: 1.5, fill: "none", seed,
      });
      // Tripod legs.
      rc.line(105, 240, 70, 280, { stroke: DARK, strokeWidth: 1.5, roughness: 1.6, seed: seed + 1 });
      rc.line(105, 240, 140, 280, { stroke: DARK, strokeWidth: 1.5, roughness: 1.6, seed: seed + 2 });
      rc.line(105, 240, 105, 280, { stroke: DARK, strokeWidth: 1.3, roughness: 1.4, seed: seed + 3 });
      // Lens.
      rc.ellipse(177, 122, 22, 14, {
        stroke: DARK, strokeWidth: 1.5, roughness: 1.4, fill: "none", seed: seed + 4,
      });
      // Crescent moon.
      rc.arc(270, 80, 60, 60, 0.8, 5.5, false, {
        stroke: INK, strokeWidth: 1.8, roughness: 1.6, fill: "none", seed: seed + 5,
      });
      rc.arc(285, 80, 45, 45, 0.8, 5.5, false, {
        stroke: INK, strokeWidth: 1.2, roughness: 1.4, fill: "none", seed: seed + 6,
      });
      // Stars.
      const star = (x: number, y: number, s: number) => {
        rc.line(x - 4, y, x + 4, y, { stroke: MID, strokeWidth: 1, roughness: 1.8, seed: s });
        rc.line(x, y - 4, x, y + 4, { stroke: MID, strokeWidth: 1, roughness: 1.8, seed: s + 50 });
      };
      star(220, 50, seed + 7);
      star(300, 140, seed + 8);
      star(250, 160, seed + 9);
      star(320, 60, seed + 10);
    },
  },
];

// ─── Daily selection ──────────────────────────────────────────────────────

function dateHash(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h + dateStr.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getDailyArtwork(): { def: ArtworkDef; seed: number } {
  const today = new Date().toISOString().slice(0, 10);
  const h = dateHash(today);
  const idx = h % ARTWORK_LIBRARY.length;
  return { def: ARTWORK_LIBRARY[idx], seed: h };
}

// ─── Component ────────────────────────────────────────────────────────────

export function PlaygroundHomeArtwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { def, seed } = useMemo(() => getDailyArtwork(), []);
  const drawnRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawnRef.current) return;
    drawnRef.current = true;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rc = rough.canvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    def.draw(rc, ctx, seed);
  }, [def, seed]);

  return (
    <div className="flex h-full items-center justify-center" data-testid="playground-home-artwork">
      <canvas
        ref={canvasRef}
        width={360}
        height={300}
        style={{ width: 360, height: 300 }}
        aria-hidden="true"
      />
    </div>
  );
}
