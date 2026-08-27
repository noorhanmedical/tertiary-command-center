// Playground SketchUI primitives.
//
// Reusable hand-drawn shells that wrap CLEAN HTML content. The pencil shell
// is drawn with Rough.js via useSketchCanvas (stable seeds, resize-aware,
// cheap); the content inside stays precise Inter typography so clinical and
// operational data remains readable (see visual-split contract §7, §50).
//
// These are the building blocks the workspace migration phases (S4–S6) will
// consume. They do not encode any application logic.
//
// Roughness discipline:
//   SketchSurface / SketchButton / SketchInput → "structural"
//   SketchDivider / table separators           → "data"
//   daily artwork                              → "decorative" (in artwork file)

import { forwardRef, useMemo, type ReactNode } from "react";
import type { RoughCanvas } from "roughjs/bin/canvas";
import { cn } from "@/lib/utils";
import { useSketchCanvas } from "./useSketchCanvas";
import {
  SKETCH_COLORS,
  sketchOptions,
  stableSeed,
  type SketchColorKey,
} from "./sketchTokens";

// ─── SketchSurface ───────────────────────────────────────────────────────────
// A paper panel with a rough hand-drawn border. Replaces Card/Panel/Section
// containers inside the Playground.

interface SketchSurfaceProps {
  children: ReactNode;
  /** Stable identity so the border geometry does not shimmer across renders. */
  seedId: string;
  className?: string;
  /** Corner rounding in px for the rough rectangle path. */
  radius?: number;
  /** Paper fill behind content. */
  warm?: boolean;
  accent?: SketchColorKey;
  padded?: boolean;
  "data-testid"?: string;
}

export function SketchSurface({
  children,
  seedId,
  className,
  radius = 10,
  warm = false,
  accent = "graphite",
  padded = true,
  "data-testid": dataTestId,
}: SketchSurfaceProps) {
  const seed = useMemo(() => stableSeed(`surface:${seedId}`), [seedId]);

  const { containerRef, canvasRef } = useSketchCanvas({
    seed,
    deps: [radius, accent],
    draw: (rc, _ctx, size, s) => {
      drawRoughRoundedRect(rc, size.width, size.height, radius, {
        ...sketchOptions("structural", accent, { strokeWidth: 1.6 }),
        seed: s,
      });
    },
  });

  return (
    <div
      ref={containerRef}
      className={cn("relative", padded && "p-4", className)}
      style={{
        backgroundColor: warm ? SKETCH_COLORS.paperWarm : SKETCH_COLORS.paper,
        borderRadius: radius,
      }}
      data-testid={dataTestId}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// ─── SketchSectionHeader ─────────────────────────────────────────────────────
// A notebook-style section header: clean title + a rough colored-pencil
// underline. No cursive — clinical section names stay legible (§11).

interface SketchSectionHeaderProps {
  title: ReactNode;
  seedId: string;
  icon?: ReactNode;
  right?: ReactNode;
  accent?: SketchColorKey;
  className?: string;
}

export function SketchSectionHeader({
  title,
  seedId,
  icon,
  right,
  accent = "blue",
  className,
}: SketchSectionHeaderProps) {
  const seed = useMemo(() => stableSeed(`header:${seedId}`), [seedId]);

  const { containerRef, canvasRef } = useSketchCanvas({
    seed,
    deps: [accent],
    draw: (rc, _ctx, size, s) => {
      const y = size.height - 3;
      rc.line(2, y, size.width - 2, y, {
        ...sketchOptions("structural", accent, { strokeWidth: 1.8 }),
        seed: s,
      });
    },
  });

  return (
    <div ref={containerRef} className={cn("relative pb-2", className)}>
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          <span className="text-[13px] font-semibold tracking-tight text-slate-800">
            {title}
          </span>
        </div>
        {right}
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      />
    </div>
  );
}

// ─── SketchButton ────────────────────────────────────────────────────────────
// Rough-bordered button with a subtle paper fill and a small press motion.
// Sizes stay controlled so it never reads as a childish bubble (§43).

// The canonical Playground button. EVERY button rendered inside the Playground
// canvas must route through this primitive (or SketchAwareButton, which selects
// it by context). Hand-drawn shell + clean Inter label; accessible focus ring
// always present; subtle 1px press. Never neon; never a glossy SaaS pill.
export type SketchButtonVariant =
  | "primary"    // pencil-blue fill accent, strong action hierarchy
  | "secondary"  // paper fill + graphite rough border (a.k.a. "default")
  | "ghost"      // minimal border, faint pencil hover fill
  | "danger"     // muted burgundy pencil accent
  | "icon";      // compact rough square, ~36px hit target

export type SketchButtonSize = "sm" | "md";

interface SketchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: SketchButtonVariant;
  size?: SketchButtonSize;
  /** Stable identity for the rough border geometry (defaults to the label). */
  seedId?: string;
  /** Visually mark an active/selected state (soft pencil wash). */
  active?: boolean;
}

const BUTTON_ACCENT: Record<SketchButtonVariant, SketchColorKey> = {
  primary: "blue",
  secondary: "graphite",
  ghost: "graphiteLight",
  danger: "red",
  icon: "graphite",
};

export const SketchButton = forwardRef<HTMLButtonElement, SketchButtonProps>(
  (
    { children, variant = "secondary", size = "md", seedId, active = false, className, disabled, ...rest },
    ref,
  ) => {
    const label = typeof children === "string" ? children : (seedId ?? "btn");
    const seed = useMemo(() => stableSeed(`button:${label}:${variant}`), [label, variant]);
    const accent = BUTTON_ACCENT[variant];
    const isIcon = variant === "icon";
    const radius = isIcon ? 9 : 8;
    // Primary/active get a slightly heavier stroke so hierarchy reads clearly.
    const strokeWidth = variant === "primary" || active ? 1.9 : 1.5;

    const { containerRef, canvasRef } = useSketchCanvas({
      seed,
      deps: [variant, active, size],
      draw: (rc, _ctx, sz, s) => {
        drawRoughRoundedRect(rc, sz.width, sz.height, radius, {
          ...sketchOptions("structural", accent, { strokeWidth }),
          seed: s,
        });
      },
    });

    // Fill: primary + active carry a soft pencil-blue wash; ghost is
    // transparent; everything else sits on paper.
    const fill =
      variant === "ghost"
        ? "transparent"
        : variant === "primary" || active
          ? "rgba(84,106,154,0.12)" // soft pencil-blue wash
          : SKETCH_COLORS.paper;

    return (
      <button
        ref={ref}
        disabled={disabled}
        data-variant={variant}
        data-active={active ? "true" : undefined}
        className={cn(
          "group relative inline-flex items-center justify-center gap-1.5 rounded-lg",
          "font-medium transition-[transform,background-color] duration-150",
          "active:translate-y-px",
          // Sizing
          isIcon
            ? size === "sm"
              ? "h-9 w-9 text-[13px]"
              : "h-10 w-10 text-sm"
            : size === "sm"
              ? "px-2.5 py-1 text-[12px]"
              : "px-3 py-1.5 text-[13px]",
          // Text color by variant
          variant === "danger" ? "text-[color:var(--sketch-red)]" : "text-slate-800",
          variant === "ghost" && "text-slate-600",
          variant === "primary" && "text-slate-900",
          // Hover (no glass shimmer): faint pencil fill on ghost, gentle lift
          "hover:brightness-[0.98]",
          variant === "ghost" && "hover:bg-slate-900/[0.04]",
          // Accessible focus — always obvious, plus pencil-blue accent
          "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)] focus-visible:ring-offset-1",
          // Disabled
          disabled && "opacity-45 cursor-not-allowed active:translate-y-0 hover:brightness-100",
          className,
        )}
        style={{ backgroundColor: fill }}
        {...rest}
      >
        <span ref={containerRef} className="pointer-events-none absolute inset-0">
          <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
        </span>
        <span className="relative inline-flex items-center gap-1.5">{children}</span>
      </button>
    );
  },
);
SketchButton.displayName = "SketchButton";

// ─── SketchInput ─────────────────────────────────────────────────────────────
// Paper-white input with a rough bottom line and a clear focus outline.
// Keyboard-accessible and high-contrast (§42, §59).

interface SketchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  seedId?: string;
  containerClassName?: string;
}

export const SketchInput = forwardRef<HTMLInputElement, SketchInputProps>(
  ({ seedId, className, containerClassName, ...rest }, ref) => {
    const seed = useMemo(() => stableSeed(`input:${seedId ?? rest.name ?? "field"}`), [seedId, rest.name]);

    const { containerRef, canvasRef } = useSketchCanvas({
      seed,
      draw: (rc, _ctx, size, s) => {
        const y = size.height - 3;
        rc.line(2, y, size.width - 2, y, {
          ...sketchOptions("structural", "graphite", { strokeWidth: 1.4 }),
          seed: s,
        });
      },
    });

    return (
      <div ref={containerRef} className={cn("relative", containerClassName)}>
        <input
          ref={ref}
          className={cn(
            "relative w-full bg-transparent px-1 py-1.5 text-[13px] text-slate-800",
            "placeholder:text-slate-400 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)] focus-visible:rounded-sm",
            className,
          )}
          style={{ backgroundColor: SKETCH_COLORS.paper }}
          {...rest}
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        />
      </div>
    );
  },
);
SketchInput.displayName = "SketchInput";

// ─── SketchTextarea ──────────────────────────────────────────────────────────
// Paper-white multiline field with a rough graphite border. Clean Inter text,
// accessible focus ring. For notes / free-text inside Playground workspaces.

interface SketchTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  seedId?: string;
  containerClassName?: string;
}

export const SketchTextarea = forwardRef<HTMLTextAreaElement, SketchTextareaProps>(
  ({ seedId, className, containerClassName, ...rest }, ref) => {
    const seed = useMemo(() => stableSeed(`textarea:${seedId ?? rest.name ?? "notes"}`), [seedId, rest.name]);

    const { containerRef, canvasRef } = useSketchCanvas({
      seed,
      draw: (rc, _ctx, size, s) => {
        drawRoughRoundedRect(rc, size.width, size.height, 8, {
          ...sketchOptions("structural", "graphite", { strokeWidth: 1.5 }),
          seed: s,
        });
      },
    });

    return (
      <div
        ref={containerRef}
        className={cn("relative", containerClassName)}
        style={{ backgroundColor: SKETCH_COLORS.paper, borderRadius: 8 }}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
        <textarea
          ref={ref}
          className={cn(
            "relative z-10 w-full resize-y bg-transparent px-3 py-2 text-[13px] text-slate-800",
            "placeholder:text-slate-400 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)] focus-visible:rounded-md",
            className,
          )}
          {...rest}
        />
      </div>
    );
  },
);
SketchTextarea.displayName = "SketchTextarea";

// ─── SketchBadge ─────────────────────────────────────────────────────────────
// Small colored-pencil chip for status/labels. Muted tones, no neon (§40).

export type SketchBadgeTone = "graphite" | "blue" | "green" | "gold" | "red" | "violet";

const BADGE_TONE: Record<SketchBadgeTone, { fg: string; bg: string }> = {
  graphite: { fg: "#334155", bg: "rgba(148,163,184,0.16)" },
  blue: { fg: SKETCH_COLORS.blue, bg: "rgba(84,106,154,0.14)" },
  green: { fg: SKETCH_COLORS.green, bg: "rgba(92,122,92,0.16)" },
  gold: { fg: "#8A6D2F", bg: "rgba(176,141,63,0.18)" },
  red: { fg: SKETCH_COLORS.red, bg: "rgba(158,74,74,0.14)" },
  violet: { fg: SKETCH_COLORS.violet, bg: "rgba(122,106,154,0.16)" },
};

export function SketchBadge({
  children,
  tone = "graphite",
  className,
}: {
  children: ReactNode;
  tone?: SketchBadgeTone;
  className?: string;
}) {
  const c = BADGE_TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        className,
      )}
      style={{ color: c.fg, backgroundColor: c.bg }}
    >
      {children}
    </span>
  );
}

// ─── SketchDivider ───────────────────────────────────────────────────────────
// Cheap subtle horizontal separator (roughness "data") for dense rows/tables.

interface SketchDividerProps {
  seedId: string;
  accent?: SketchColorKey;
  className?: string;
}

export function SketchDivider({ seedId, accent = "graphiteLight", className }: SketchDividerProps) {
  const seed = useMemo(() => stableSeed(`divider:${seedId}`), [seedId]);

  const { containerRef, canvasRef } = useSketchCanvas({
    seed,
    deps: [accent],
    draw: (rc, _ctx, size, s) => {
      const y = Math.round(size.height / 2);
      rc.line(0, y, size.width, y, {
        ...sketchOptions("data", accent, { strokeWidth: 1 }),
        seed: s,
      });
    },
  });

  return (
    <div ref={containerRef} className={cn("relative h-2 w-full", className)}>
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
    </div>
  );
}

// ─── Rough geometry helper ───────────────────────────────────────────────────
// A rounded rectangle traced as a single rough path so the border reads as one
// continuous hand-drawn stroke rather than four disconnected lines.

function drawRoughRoundedRect(
  rc: RoughCanvas,
  w: number,
  h: number,
  r: number,
  options: Parameters<RoughCanvas["path"]>[1],
) {
  const inset = 1.5;
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
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
