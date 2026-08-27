// Playground Home Artwork — daily hand-drawn scene, drawn directly on the
// Playground canvas. No card, no panel, no tile, no tinted region.
//
// Current scene: BICYCLE DAY. A larger (~520px) notebook scene with a
// complete dark bicycle as the subject and an intentionally UNFINISHED
// lighter background around it (partial path, half-drawn tree, a fence
// fragment, faint cloud outlines, stray construction marks).
//
// Layering:
//   • base layer  — static geometry, drawn once with a stable per-day seed
//                    (same scene all day, no redraw on refresh)
//   • motion layer — a few animated overlay elements (front/rear spokes,
//                    pedal, one drifting cloud) redrawn on a slow rAF with
//                    de-synced timing so it feels hand-animated, not looped
//
// The whole thing is aria-hidden decoration and pointer-events-none so it
// never blocks workspace chrome. It only renders for playground_home.

import { useEffect, useRef } from "react";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import {
  SKETCH_COLORS,
  SKETCH_LINE,
  sketchOptions,
  stableSeed,
  dailySeedIdentity,
} from "../sketch/sketchTokens";

// Scene coordinate space (drawn at this size, then CSS-scaled responsively).
const SCENE_W = 520;
const SCENE_H = 380;

// Bicycle geometry within the scene (centered-ish, room for background).
const REAR = { x: 175, y: 250, r: 58 };
const FRONT = { x: 355, y: 250, r: 58 };
const CRANK = { x: 265, y: 250 };
const SEAT = { x: 230, y: 168 };
const HEAD = { x: 335, y: 172 };

// ─── Unfinished background (lighter, incomplete) ─────────────────────────────

function drawBackground(rc: RoughCanvas, seed: number) {
  const faint = (color: keyof typeof SKETCH_COLORS, level: "structural" | "decorative" = "structural") =>
    sketchOptions(level, color, { strokeWidth: 1.2 });

  // Faint cloud outlines (unclosed contours, top area).
  rc.path("M 70 70 Q 90 52 120 60 Q 150 50 168 70", {
    ...faint("graphiteLight", "decorative"),
    strokeWidth: 1.1,
    stroke: `rgba(148,163,184,${SKETCH_LINE.opacityFaint})`,
    seed: seed + 201,
  });
  rc.path("M 360 55 Q 388 40 415 52 Q 440 46 452 62", {
    ...faint("graphiteLight", "decorative"),
    strokeWidth: 1.1,
    stroke: `rgba(148,163,184,${SKETCH_LINE.opacityFaint})`,
    seed: seed + 202,
  });

  // Half-drawn tree on the left — trunk + a couple of branches, canopy left open.
  const treeInk = `rgba(92,122,92,${SKETCH_LINE.opacityFaint + 0.08})`;
  rc.line(66, 300, 70, 190, { roughness: 1.6, bowing: 1, strokeWidth: 1.6, stroke: treeInk, seed: seed + 210 });
  rc.line(70, 220, 44, 190, { roughness: 1.7, bowing: 1.1, strokeWidth: 1.3, stroke: treeInk, seed: seed + 211 });
  rc.line(70, 232, 96, 205, { roughness: 1.7, bowing: 1.1, strokeWidth: 1.3, stroke: treeInk, seed: seed + 212 });
  // Canopy: intentionally unclosed scribble.
  rc.path("M 40 185 Q 55 150 90 160 Q 110 150 108 178", {
    roughness: 2, bowing: 1.3, strokeWidth: 1.2, fill: "none",
    stroke: `rgba(92,122,92,${SKETCH_LINE.opacityFaint})`,
    seed: seed + 213,
  });

  // Fence fragment on the right — a few posts + one rail, trailing off.
  // Faint cool blue-graphite (winter palette; no warm ochre).
  const fence = `rgba(176,141,63,${SKETCH_LINE.opacityFaint + 0.06})`;
  for (let i = 0; i < 3; i++) {
    const x = 430 + i * 26;
    rc.line(x, 300, x, 258, { roughness: 1.3, strokeWidth: 1.3, stroke: fence, seed: seed + 220 + i });
  }
  rc.line(426, 268, 486, 266, { roughness: 1.4, bowing: 0.8, strokeWidth: 1.2, stroke: fence, seed: seed + 230 });

  // Ground / path — rough incomplete line that fades at both ends.
  rc.path("M 40 306 Q 260 316 500 304", {
    roughness: 1.8, bowing: 1.1, strokeWidth: 1.4, fill: "none",
    stroke: `rgba(148,163,184,${SKETCH_LINE.opacityFaint + 0.1})`,
    seed: seed + 240,
  });
  // Unfinished sidewalk edge (only a short segment).
  rc.path("M 150 320 Q 240 326 330 320", {
    roughness: 1.9, bowing: 1.2, strokeWidth: 1, fill: "none",
    stroke: `rgba(148,163,184,${SKETCH_LINE.opacityFaint})`,
    seed: seed + 241,
  });

  // A few stray grass / construction marks near the ground.
  const grass = `rgba(92,122,92,${SKETCH_LINE.opacityFaint})`;
  for (let i = 0; i < 5; i++) {
    const x = 110 + i * 60 + (i % 2) * 12;
    rc.line(x, 312, x - 3, 300, { roughness: 1.6, strokeWidth: 1, stroke: grass, seed: seed + 250 + i });
    rc.line(x + 4, 312, x + 6, 301, { roughness: 1.6, strokeWidth: 1, stroke: grass, seed: seed + 260 + i });
  }

  // Faint pencil construction guide marks (the "unfinished sketch" feel).
  rc.line(455, 120, 480, 108, { roughness: 1, strokeWidth: 0.8, stroke: `rgba(148,163,184,0.18)`, seed: seed + 270 });
  rc.line(30, 130, 52, 122, { roughness: 1, strokeWidth: 0.8, stroke: `rgba(148,163,184,0.18)`, seed: seed + 271 });
}

// ─── Bicycle base (dark, complete — minus the animated overlay pieces) ───────

function drawBicycleBase(rc: RoughCanvas, seed: number) {
  const ink = sketchOptions("decorative", "graphite", { strokeWidth: 2.4, bowing: 0.9 });
  const dark = sketchOptions("decorative", "graphite", { strokeWidth: 1.9, bowing: 0.9, stroke: "#374151" });
  const blue = sketchOptions("structural", "blue", { strokeWidth: 1.4 });

  // Ground shadow beneath the bike — light hachure (not a CSS shadow).
  rc.path(`M ${REAR.x - 40} ${REAR.y + 62} Q 265 ${REAR.y + 74} ${FRONT.x + 40} ${FRONT.y + 62}`, {
    roughness: 2, strokeWidth: 0.9, fill: "none",
    stroke: `rgba(148,163,184,0.5)`, seed: seed + 300,
  });
  rc.path(`M ${REAR.x - 20} ${REAR.y + 68} Q 265 ${REAR.y + 76} ${FRONT.x + 20} ${FRONT.y + 68}`, {
    roughness: 2.2, strokeWidth: 0.7, fill: "none",
    stroke: `rgba(148,163,184,0.4)`, seed: seed + 301,
  });

  // Wheel rims (multiple imperfect passes handled by roughness).
  rc.circle(REAR.x, REAR.y, REAR.r * 2, { ...ink, seed: seed + 2 });
  rc.circle(FRONT.x, FRONT.y, FRONT.r * 2, { ...ink, seed: seed + 3 });
  // Hubs.
  rc.circle(REAR.x, REAR.y, 12, { ...dark, seed: seed + 4 });
  rc.circle(FRONT.x, FRONT.y, 12, { ...dark, seed: seed + 5 });

  // Frame — main triangle.
  rc.line(SEAT.x, SEAT.y, REAR.x, REAR.y, { ...ink, seed: seed + 10 }); // seat tube
  rc.line(SEAT.x, SEAT.y, HEAD.x, HEAD.y, { ...ink, seed: seed + 11 }); // top tube
  rc.line(HEAD.x, HEAD.y, CRANK.x, CRANK.y, { ...ink, seed: seed + 12 }); // down tube
  rc.line(REAR.x, REAR.y, CRANK.x, CRANK.y, { ...dark, seed: seed + 13 }); // chain stay
  rc.line(REAR.x, REAR.y, SEAT.x, SEAT.y, { ...dark, seed: seed + 14 }); // seat stay
  rc.line(SEAT.x, SEAT.y, CRANK.x, CRANK.y, { ...dark, seed: seed + 15 }); // seat->crank

  // Fork to front wheel.
  rc.line(HEAD.x, HEAD.y, FRONT.x, FRONT.y, { ...ink, seed: seed + 16 });

  // Handlebar + stem.
  rc.line(HEAD.x, HEAD.y, HEAD.x, HEAD.y - 16, { ...dark, seed: seed + 17 });
  rc.path(`M ${HEAD.x - 16} ${HEAD.y - 20} Q ${HEAD.x} ${HEAD.y - 24} ${HEAD.x + 14} ${HEAD.y - 14} Q ${HEAD.x + 22} ${HEAD.y - 8} ${HEAD.x + 6} ${HEAD.y - 6}`, {
    ...dark, fill: "none", seed: seed + 18,
  });

  // Seat.
  rc.line(SEAT.x, SEAT.y, SEAT.x, SEAT.y - 8, { ...dark, seed: seed + 19 });
  rc.path(`M ${SEAT.x - 14} ${SEAT.y - 10} Q ${SEAT.x} ${SEAT.y - 16} ${SEAT.x + 12} ${SEAT.y - 9}`, {
    ...ink, fill: "none", seed: seed + 20,
  });

  // Crank spider.
  rc.circle(CRANK.x, CRANK.y, 24, { ...dark, seed: seed + 21 });

  // Chain suggestion (rear hub -> crank).
  rc.path(`M ${REAR.x + 6} ${REAR.y + 4} Q ${(REAR.x + CRANK.x) / 2} ${REAR.y + 12} ${CRANK.x - 6} ${CRANK.y + 4}`, {
    roughness: 1.8, strokeWidth: 1, fill: "none", stroke: SKETCH_COLORS.graphiteLight, seed: seed + 22,
  });

  // Muted blue pencil accent along the top tube.
  rc.line(SEAT.x + 6, SEAT.y + 1, HEAD.x - 6, HEAD.y + 1, { ...blue, seed: seed + 30 });
}

// ─── Animated overlay (spokes, pedal, drifting cloud) ────────────────────────

function drawSpokes(
  rc: RoughCanvas,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  seed: number,
) {
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rotation;
    const x2 = cx + Math.cos(angle) * radius;
    const y2 = cy + Math.sin(angle) * radius;
    rc.line(cx, cy, x2, y2, {
      roughness: 1.6,
      strokeWidth: 0.7,
      stroke: `rgba(71,85,105,0.8)`,
      // Stable per-spoke seed so wobble doesn't shimmer between frames.
      seed: seed + 400 + i,
    });
  }
}

function drawPedal(rc: RoughCanvas, angle: number, seed: number) {
  const armLen = 22;
  const px = CRANK.x + Math.cos(angle) * armLen;
  const py = CRANK.y + Math.sin(angle) * armLen;
  rc.line(CRANK.x, CRANK.y, px, py, {
    roughness: 1.3, strokeWidth: 2, stroke: "#374151", seed: seed + 420,
  });
  rc.line(px - 7, py, px + 7, py, {
    roughness: 1.4, strokeWidth: 2.2, stroke: SKETCH_COLORS.graphite, seed: seed + 421,
  });
}

function drawDriftCloud(rc: RoughCanvas, offsetX: number, seed: number) {
  const x = 250 + offsetX;
  rc.path(`M ${x} 46 Q ${x + 18} 30 ${x + 46} 40 Q ${x + 70} 32 ${x + 82} 50`, {
    roughness: 1.9, bowing: 1.2, strokeWidth: 1.1, fill: "none",
    stroke: `rgba(148,163,184,${SKETCH_LINE.opacityFaint})`, seed: seed + 440,
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PlaygroundHomeArtwork() {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);

  const seed = stableSeed(`bicycle:${dailySeedIdentity()}`);

  // Base layer — draw once (stable per day).
  useEffect(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SCENE_W * dpr;
    canvas.height = SCENE_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);
    const rc = rough.canvas(canvas);
    drawBackground(rc, seed);
    drawBicycleBase(rc, seed);
  }, [seed]);

  // Motion layer — slow, de-synced, non-looping-feeling idle life.
  useEffect(() => {
    const canvas = motionCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SCENE_W * dpr;
    canvas.height = SCENE_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rc = rough.canvas(canvas);

    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = 0;
    const start = performance.now();

    const frame = (now: number) => {
      // Throttle to ~12fps — calm, cheap, and pencil geometry tolerates it.
      if (now - last < 80) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = now;
      const t = (now - start) / 1000;

      ctx.clearRect(0, 0, SCENE_W, SCENE_H);

      if (prefersReduced) {
        // Static resting pose.
        drawSpokes(rc, REAR.x, REAR.y, REAR.r - 8, 0.1, seed);
        drawSpokes(rc, FRONT.x, FRONT.y, FRONT.r - 8, 0.3, seed);
        drawPedal(rc, Math.PI / 2, seed);
        drawDriftCloud(rc, 0, seed);
        return;
      }

      // Very slow, de-synchronized rotation using summed slow sines so it
      // never reads as a fixed "spin every N seconds" loop.
      const rearRot = 0.08 * Math.sin(t * 0.18) + 0.05 * Math.sin(t * 0.07 + 1.3);
      const frontRot = 0.08 * Math.sin(t * 0.15 + 0.6) + 0.05 * Math.sin(t * 0.09 + 2.1);
      const pedalAngle = Math.PI / 2 + 0.18 * Math.sin(t * 0.22) + 0.06 * Math.sin(t * 0.11);
      const cloudDrift = 3 * Math.sin(t * 0.05);

      drawSpokes(rc, REAR.x, REAR.y, REAR.r - 8, rearRot, seed);
      drawSpokes(rc, FRONT.x, FRONT.y, FRONT.r - 8, frontRot, seed);
      drawPedal(rc, pedalAngle, seed);
      drawDriftCloud(rc, cloudDrift, seed);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [seed]);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center pb-20"
      data-testid="playground-home-artwork"
      aria-hidden="true"
    >
      <div
        className="relative"
        style={{ width: SCENE_W, height: SCENE_H, maxWidth: "90vw" }}
      >
        <canvas
          ref={baseCanvasRef}
          className="absolute inset-0"
          style={{ width: "100%", height: "100%" }}
        />
        <canvas
          ref={motionCanvasRef}
          className="absolute inset-0"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
