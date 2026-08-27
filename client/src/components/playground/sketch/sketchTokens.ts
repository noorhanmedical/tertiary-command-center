// Playground SketchUI — centralized design tokens & Rough.js presets.
//
// This is the single source of truth for the Playground's "digital notebook"
// visual language. Everything rendered INSIDE the Playground canvas derives
// its pencil colors, paper tones, roughness, and hatch settings from here.
//
// Do NOT scatter raw Rough.js option objects across components. Import a
// roughness level + a palette color from this file instead.
//
// Scope boundary: these tokens apply to Playground workspaces ONLY. The
// Team Portal shell (dock, rails, top controls) stays Liquid Glass and must
// not consume these tokens.

import type { Options as RoughOptions } from "roughjs/bin/core";

// ─── Pencil palette ────────────────────────────────────────────────────────
// Muted colored-pencil translations of the Plexus color system. No saturated
// marker colors — everything reads like graphite + soft colored pencil on
// warm paper.

// Muted colored-pencil translations of the Plexus color system. No saturated
// marker colors — everything reads like graphite + soft colored pencil on
// warm paper.
export const SKETCH_COLORS = {
  graphite: "#1F2937",
  graphiteSoft: "#475569",
  graphiteLight: "#94A3B8",
  blue: "#546A9A", // muted pencil navy (Plexus blue)
  blueDeep: "#3D5480",
  blueLight: "#AFC0DE",
  indigo: "#4C5C8A",
  red: "#9E4A4A", // burgundy pencil (error)
  green: "#5C7A5C", // muted green pencil (complete)
  gold: "#B08D3F", // ochre/amber pencil (pending)
  violet: "#7A6A9A", // muted violet pencil (purple)
  snow: "#FFFFFF",
  paper: "#FAFBFD", // paper-white canvas
  paperSoft: "#F6F4EE",
  paperDeep: "#F0EDE3",
  ice: "#EAF0F7",
  paperWarm: "#F6F4EE", // warm notebook surface
} as const;

export type SketchColorKey = keyof typeof SKETCH_COLORS;

// ─── Line opacity + hatch ───────────────────────────────────────────────────

export const SKETCH_LINE = {
  /** Main subject / complete strokes. */
  opacityStrong: 0.92,
  /** Structural workspace edges. */
  opacityMedium: 0.7,
  /** Unfinished / background construction marks. */
  opacityFaint: 0.32,
  hatchGap: 5,
} as const;

// ─── Roughness levels ────────────────────────────────────────────────────────
// Three controlled tiers. Pick the tier by INTENT, not by eye:
//   DECORATIVE  → daily artwork, empty-state illustration (most hand-drawn)
//   STRUCTURAL  → workspace panels, section boundaries, buttons, dialog edges
//   DATA        → table separators, dense repeated rows (barely-there wobble)

export type SketchRoughnessLevel = "decorative" | "structural" | "data";

interface RoughnessPreset {
  roughness: number;
  bowing: number;
  strokeWidth: number;
}

export const SKETCH_ROUGHNESS: Record<SketchRoughnessLevel, RoughnessPreset> = {
  decorative: { roughness: 1.7, bowing: 1.1, strokeWidth: 2.2 },
  structural: { roughness: 1.0, bowing: 0.7, strokeWidth: 1.5 },
  data: { roughness: 0.5, bowing: 0.3, strokeWidth: 1.0 },
};

// ─── Rough.js option builder ─────────────────────────────────────────────────
// Produces a stable Rough.js Options object from a roughness level + color +
// optional overrides. Always pass a stable `seed` so geometry does not change
// on every React render (see stableSeed).

export function sketchOptions(
  level: SketchRoughnessLevel,
  color: SketchColorKey = "graphite",
  overrides: Partial<RoughOptions> = {},
): RoughOptions {
  const preset = SKETCH_ROUGHNESS[level];
  return {
    roughness: preset.roughness,
    bowing: preset.bowing,
    strokeWidth: preset.strokeWidth,
    stroke: SKETCH_COLORS[color],
    fill: "none",
    hachureGap: SKETCH_LINE.hatchGap,
    ...overrides,
  };
}

// ─── Stable seed helper ──────────────────────────────────────────────────────
// Deterministic 31-bit hash → Rough.js seed. Feed it a stable identity string
// (component id, workspace id, or daily date) so the sketch geometry is stable
// across renders and, where desired, stable across the whole day.

export function stableSeed(identity: string | number): number {
  const str = String(identity);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Today's YYYY-MM-DD in local time — the daily-artwork seed identity. */
export function dailySeedIdentity(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── CSS custom properties ───────────────────────────────────────────────────
// Injected once by PlaygroundSketchProvider so non-canvas SketchUI primitives
// (borders, fills, focus rings) can reference the same palette from CSS.

export const SKETCH_CSS_VARS: Record<string, string> = {
  "--sketch-graphite": SKETCH_COLORS.graphite,
  "--sketch-graphite-soft": SKETCH_COLORS.graphiteSoft,
  "--sketch-graphite-light": SKETCH_COLORS.graphiteLight,
  "--sketch-blue": SKETCH_COLORS.blue,
  "--sketch-blue-deep": SKETCH_COLORS.blueDeep,
  "--sketch-blue-light": SKETCH_COLORS.blueLight,
  "--sketch-indigo": SKETCH_COLORS.indigo,
  "--sketch-red": SKETCH_COLORS.red,
  "--sketch-green": SKETCH_COLORS.green,
  "--sketch-gold": SKETCH_COLORS.gold,
  "--sketch-violet": SKETCH_COLORS.violet,
  "--sketch-snow": SKETCH_COLORS.snow,
  "--sketch-paper": SKETCH_COLORS.paper,
  "--sketch-paper-soft": SKETCH_COLORS.paperSoft,
  "--sketch-paper-deep": SKETCH_COLORS.paperDeep,
  "--sketch-ice": SKETCH_COLORS.ice,
  "--sketch-paper-warm": SKETCH_COLORS.paperWarm,
  "--sketch-border": "rgba(31,41,55,0.5)",
  "--sketch-line-opacity": String(SKETCH_LINE.opacityMedium),
  "--sketch-roughness": String(SKETCH_ROUGHNESS.structural.roughness),
  "--sketch-hatch-gap": String(SKETCH_LINE.hatchGap),
};
