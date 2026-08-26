// Playground Home Artwork — colored-pencil bicycle with scenery.
//
// Hand-drawn bicycle in a park-like setting. Colored pencil palette.
// Hover: drawing slowly fades away. Subtle wheel/pedal animation.
// No card, no container — sits directly on the canvas.

import { useEffect, useRef, useState } from "react";
import rough from "roughjs";

// ─── Colored pencil palette ───────────────────────────────────────────────

const INK = "#2D3748";        // dark graphite
const FRAME = "#1A365D";      // navy frame
const ACCENT = "#9B2335";     // burgundy accent
const WHEEL = "#2D3748";      // dark wheel
const SPOKE = "#718096";      // silver spoke
const GROUND = "#5D7A3A";     // grass green
const GROUND_DARK = "#3D5A2A";// dark grass
const SKY_TOP = "#B7C9E2";   // soft sky
const TREE = "#2F5233";       // pine/tree green
const TREE_TRUNK = "#6B4C3B"; // brown trunk
const PATH = "#C4A882";       // sandy path
const FLOWER_1 = "#C2547D";   // dusty pink
const FLOWER_2 = "#E8A838";   // warm gold
const SUN = "#E8C44A";        // muted gold sun
const CLOUD = "#E2E8F0";      // soft cloud

// ─── Draw the full scene ──────────────────────────────────────────────────

function drawScene(rc: ReturnType<typeof rough.canvas>, ctx: CanvasRenderingContext2D, seed: number) {
  const s = seed;
  const W = 480;
  const H = 320;

  // ── Sky gradient (manual pencil strokes) ──
  for (let y = 0; y < 140; y += 8) {
    const opacity = 0.15 - y * 0.0008;
    rc.line(0, y, W, y + 2, {
      stroke: SKY_TOP, strokeWidth: 6, roughness: 3, seed: s + y, bowing: 2,
    });
  }

  // ── Distant hills ──
  rc.path("M 0 150 Q 80 120 160 140 Q 240 125 320 138 Q 400 128 480 145 L 480 180 L 0 180 Z", {
    stroke: GROUND_DARK, strokeWidth: 1, roughness: 1.8,
    fill: GROUND_DARK, fillStyle: "hachure", hachureGap: 3, hachureAngle: -30,
    fillWeight: 0.6, seed: s + 100,
  });

  // ── Sun ──
  rc.circle(380, 55, 36, {
    stroke: SUN, strokeWidth: 1.5, roughness: 1.4,
    fill: SUN, fillStyle: "hachure", hachureGap: 3, hachureAngle: 45,
    fillWeight: 0.5, seed: s + 101,
  });

  // ── Cloud ──
  rc.path("M 60 50 Q 75 35 95 42 Q 110 30 130 40 Q 145 35 155 48 Q 150 58 130 58 Q 110 62 90 58 Q 70 60 60 50 Z", {
    stroke: CLOUD, strokeWidth: 1, roughness: 2,
    fill: CLOUD, fillStyle: "solid", fillWeight: 0.3, seed: s + 102,
  });

  // ── Tree (left background) ──
  rc.line(70, 165, 70, 120, { stroke: TREE_TRUNK, strokeWidth: 4, roughness: 1.6, seed: s + 110 });
  rc.path("M 45 125 Q 70 80 95 125 Z", {
    stroke: TREE, strokeWidth: 1.5, roughness: 1.8,
    fill: TREE, fillStyle: "hachure", hachureGap: 4, hachureAngle: -40,
    fillWeight: 0.7, seed: s + 111,
  });
  rc.path("M 52 140 Q 70 100 88 140 Z", {
    stroke: TREE, strokeWidth: 1.2, roughness: 1.6,
    fill: TREE, fillStyle: "hachure", hachureGap: 5, hachureAngle: -35,
    fillWeight: 0.5, seed: s + 112,
  });

  // ── Tree (right background) ──
  rc.line(400, 160, 400, 125, { stroke: TREE_TRUNK, strokeWidth: 3.5, roughness: 1.5, seed: s + 113 });
  rc.path("M 380 130 Q 400 95 420 130 Z", {
    stroke: TREE, strokeWidth: 1.3, roughness: 1.7,
    fill: TREE, fillStyle: "hachure", hachureGap: 4, hachureAngle: -45,
    fillWeight: 0.6, seed: s + 114,
  });

  // ── Ground / grass ──
  rc.path("M 0 180 Q 120 175 240 180 Q 360 178 480 180 L 480 320 L 0 320 Z", {
    stroke: "none", strokeWidth: 0, roughness: 0,
    fill: GROUND, fillStyle: "hachure", hachureGap: 3, hachureAngle: -25,
    fillWeight: 0.5, seed: s + 120,
  });

  // ── Path/road ──
  rc.path("M 0 260 Q 120 250 240 255 Q 360 248 480 255 L 480 275 Q 360 268 240 272 Q 120 270 0 278 Z", {
    stroke: PATH, strokeWidth: 1, roughness: 1.5,
    fill: PATH, fillStyle: "hachure", hachureGap: 4, hachureAngle: 10,
    fillWeight: 0.4, seed: s + 121,
  });

  // ── Flowers ──
  const flowers = [[130, 230], [160, 240], [310, 235], [340, 225], [440, 245]];
  flowers.forEach(([fx, fy], i) => {
    const color = i % 2 === 0 ? FLOWER_1 : FLOWER_2;
    rc.circle(fx, fy, 6, { stroke: color, strokeWidth: 1.5, roughness: 2, fill: "none", seed: s + 130 + i });
    rc.line(fx, fy + 3, fx, fy + 12, { stroke: GROUND_DARK, strokeWidth: 0.8, roughness: 1.5, seed: s + 140 + i });
  });

  // ── BICYCLE ──
  const bx = 200; // bike center x offset
  const by = 10;  // bike y offset

  // Rear wheel.
  rc.circle(bx + 100, by + 240, 72, { stroke: WHEEL, strokeWidth: 2.2, roughness: 1.5, fill: "none", seed: s + 200 });
  rc.circle(bx + 100, by + 240, 8, { stroke: WHEEL, strokeWidth: 1.5, roughness: 1.3, fill: "none", seed: s + 201 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    rc.line(bx + 100, by + 240, bx + 100 + Math.cos(a) * 34, by + 240 + Math.sin(a) * 34, {
      stroke: SPOKE, strokeWidth: 0.6, roughness: 1.6, seed: s + 210 + i,
    });
  }

  // Front wheel.
  rc.circle(bx + 240, by + 240, 72, { stroke: WHEEL, strokeWidth: 2.2, roughness: 1.5, fill: "none", seed: s + 220 });
  rc.circle(bx + 240, by + 240, 8, { stroke: WHEEL, strokeWidth: 1.5, roughness: 1.3, fill: "none", seed: s + 221 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    rc.line(bx + 240, by + 240, bx + 240 + Math.cos(a) * 34, by + 240 + Math.sin(a) * 34, {
      stroke: SPOKE, strokeWidth: 0.6, roughness: 1.6, seed: s + 230 + i,
    });
  }

  // Frame.
  rc.line(bx + 130, by + 195, bx + 100, by + 240, { stroke: FRAME, strokeWidth: 2.5, roughness: 1.4, seed: s + 240 });
  rc.line(bx + 130, by + 195, bx + 210, by + 198, { stroke: FRAME, strokeWidth: 2.3, roughness: 1.3, seed: s + 241 });
  rc.line(bx + 210, by + 198, bx + 100, by + 240, { stroke: FRAME, strokeWidth: 2.2, roughness: 1.4, seed: s + 242 });
  rc.line(bx + 100, by + 240, bx + 155, by + 240, { stroke: FRAME, strokeWidth: 1.8, roughness: 1.3, seed: s + 243 });
  rc.line(bx + 100, by + 240, bx + 130, by + 195, { stroke: FRAME, strokeWidth: 1.6, roughness: 1.4, seed: s + 244 });

  // Fork.
  rc.line(bx + 210, by + 198, bx + 240, by + 240, { stroke: FRAME, strokeWidth: 2, roughness: 1.3, seed: s + 245 });

  // Handlebar.
  rc.path(`M ${bx + 198} ${by + 185} Q ${bx + 210} ${by + 182} ${bx + 220} ${by + 188} Q ${bx + 225} ${by + 195} ${bx + 212} ${by + 198}`, {
    stroke: INK, strokeWidth: 2, roughness: 1.5, fill: "none", seed: s + 246,
  });

  // Seat.
  rc.path(`M ${bx + 120} ${by + 190} Q ${bx + 130} ${by + 186} ${bx + 140} ${by + 190}`, {
    stroke: ACCENT, strokeWidth: 2.5, roughness: 1.4, fill: "none", seed: s + 247,
  });
  rc.line(bx + 130, by + 190, bx + 130, by + 198, { stroke: INK, strokeWidth: 1.8, roughness: 1.2, seed: s + 248 });

  // Crank + pedal.
  rc.circle(bx + 155, by + 240, 16, { stroke: INK, strokeWidth: 1.8, roughness: 1.4, fill: "none", seed: s + 249 });
  rc.line(bx + 155, by + 240, bx + 163, by + 250, { stroke: INK, strokeWidth: 2, roughness: 1.3, seed: s + 250 });
  rc.rectangle(bx + 160, by + 248, 10, 4, { stroke: INK, strokeWidth: 1.2, roughness: 1.5, fill: "none", seed: s + 251 });

  // Chain suggestion.
  rc.path(`M ${bx + 105} ${by + 244} Q ${bx + 130} ${by + 248} ${bx + 155} ${by + 244}`, {
    stroke: SPOKE, strokeWidth: 0.9, roughness: 1.8, fill: "none", seed: s + 252,
  });

  // Accent stripe on frame.
  rc.line(bx + 135, by + 197, bx + 200, by + 198, {
    stroke: ACCENT, strokeWidth: 1.5, roughness: 1.2, seed: s + 253,
  });
}

// ─── Component ────────────────────────────────────────────────────────────

export function PlaygroundHomeArtwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnRef = useRef(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawnRef.current) return;
    drawnRef.current = true;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rc = rough.canvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Daily seed for subtle variation.
    const today = new Date().toISOString().slice(0, 10);
    let seed = 0;
    for (let i = 0; i < today.length; i++) seed = ((seed << 5) - seed + today.charCodeAt(i)) | 0;
    seed = Math.abs(seed);

    drawScene(rc, ctx, seed);
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center pb-20"
      data-testid="playground-home-artwork"
      aria-hidden="true"
    >
      <div
        className="pointer-events-auto relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <canvas
          ref={canvasRef}
          width={480}
          height={320}
          className="max-w-[90vw] transition-opacity duration-[2000ms] ease-out"
          style={{
            width: 480,
            height: 320,
            opacity: hovered ? 0 : 1,
          }}
        />
        {/* Subtle wheel animation overlay — CSS only, very slow */}
        <div
          className="absolute pointer-events-none"
          style={{ top: 250, left: 300, width: 72, height: 72, transform: "translate(-50%, -50%)" }}
        >
          <div className="w-full h-full rounded-full border border-transparent playground-wheel-spin" />
        </div>
        <div
          className="absolute pointer-events-none"
          style={{ top: 250, left: 440, width: 72, height: 72, transform: "translate(-50%, -50%)" }}
        >
          <div className="w-full h-full rounded-full border border-transparent playground-wheel-spin-slow" />
        </div>
      </div>

      <style>{`
        @keyframes playground-wheel {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(8deg); }
        }
        @keyframes playground-wheel-rev {
          0% { transform: rotate(0deg); }
          50% { transform: rotate(5deg); }
          100% { transform: rotate(0deg); }
        }
        .playground-wheel-spin {
          animation: playground-wheel-rev 18s ease-in-out infinite;
        }
        .playground-wheel-spin-slow {
          animation: playground-wheel-rev 22s ease-in-out infinite;
          animation-delay: 3s;
        }
        @media (prefers-reduced-motion: reduce) {
          .playground-wheel-spin, .playground-wheel-spin-slow { animation: none; }
        }
      `}</style>
    </div>
  );
}
