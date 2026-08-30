// Playground primitives — CLEAN (SketchUI look removed).
//
// These used to draw a hand-drawn Rough.js "pencil" shell on a <canvas>. The
// SketchUI look has been removed platform-wide; each primitive now renders a
// plain, modern shadcn/HTML element. The exported API (component names + props)
// is UNCHANGED so all existing call sites keep working without edits — only the
// visual language changed (clean cards/buttons/inputs instead of pencil).
//
// The `seedId` / `radius` / `warm` / `accent` props are accepted for API
// compatibility; the ones that only affected the hand-drawn geometry are now
// no-ops.

import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  SKETCH_COLORS,
  type SketchColorKey,
} from "./sketchTokens";

// ─── SketchSurface ───────────────────────────────────────────────────────────
// Clean card/panel container.

interface SketchSurfaceProps {
  children: ReactNode;
  /** Accepted for API compatibility (previously the sketch geometry seed). */
  seedId: string;
  className?: string;
  /** Corner rounding in px. */
  radius?: number;
  /** Slightly warmer surface tint. */
  warm?: boolean;
  accent?: SketchColorKey;
  padded?: boolean;
  "data-testid"?: string;
}

export function SketchSurface({
  children,
  className,
  radius = 12,
  warm = false,
  padded = true,
  "data-testid": dataTestId,
}: SketchSurfaceProps) {
  return (
    <div
      className={cn(
        "relative border border-slate-200 shadow-sm",
        padded && "p-4",
        className,
      )}
      style={{
        backgroundColor: warm ? "#FBFAF7" : "#FFFFFF",
        borderRadius: radius,
      }}
      data-testid={dataTestId}
    >
      {children}
    </div>
  );
}

// ─── SketchSectionHeader ─────────────────────────────────────────────────────
// Clean section header: title + optional icon/right slot + a thin underline.

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
  icon,
  right,
  className,
}: SketchSectionHeaderProps) {
  return (
    <div className={cn("relative border-b border-slate-200 pb-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          <span className="text-[13px] font-semibold tracking-tight text-slate-800">
            {title}
          </span>
        </div>
        {right}
      </div>
    </div>
  );
}

// ─── SketchButton ────────────────────────────────────────────────────────────
// Clean shadcn button. Variants map to the shadcn vocabulary.

export type SketchButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon";

export type SketchButtonSize = "sm" | "md";

interface SketchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: SketchButtonVariant;
  size?: SketchButtonSize;
  /** Accepted for API compatibility (previously the sketch geometry seed). */
  seedId?: string;
  /** Visually mark an active/selected state. */
  active?: boolean;
}

const VARIANT_MAP: Record<SketchButtonVariant, ButtonProps["variant"]> = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
  danger: "destructive",
  icon: "ghost",
};

export const SketchButton = forwardRef<HTMLButtonElement, SketchButtonProps>(
  (
    { children, variant = "secondary", size = "md", seedId: _seedId, active = false, className, ...rest },
    ref,
  ) => {
    const isIcon = variant === "icon";
    return (
      <Button
        ref={ref}
        variant={VARIANT_MAP[variant]}
        size={isIcon ? "icon" : size === "sm" ? "sm" : "default"}
        data-variant={variant}
        data-active={active ? "true" : undefined}
        aria-pressed={active || undefined}
        className={cn(active && "ring-1 ring-primary/40", className)}
        {...rest}
      >
        {children}
      </Button>
    );
  },
);
SketchButton.displayName = "SketchButton";

// ─── SketchInput ─────────────────────────────────────────────────────────────

interface SketchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  seedId?: string;
  containerClassName?: string;
}

export const SketchInput = forwardRef<HTMLInputElement, SketchInputProps>(
  ({ seedId: _seedId, className, containerClassName, ...rest }, ref) => {
    return (
      <div className={cn("relative", containerClassName)}>
        <input
          ref={ref}
          className={cn(
            "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-800",
            "placeholder:text-slate-400 outline-none",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary",
            className,
          )}
          {...rest}
        />
      </div>
    );
  },
);
SketchInput.displayName = "SketchInput";

// ─── SketchTextarea ──────────────────────────────────────────────────────────

interface SketchTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  seedId?: string;
  containerClassName?: string;
}

export const SketchTextarea = forwardRef<HTMLTextAreaElement, SketchTextareaProps>(
  ({ seedId: _seedId, className, containerClassName, ...rest }, ref) => {
    return (
      <div className={cn("relative", containerClassName)}>
        <textarea
          ref={ref}
          className={cn(
            "w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800",
            "placeholder:text-slate-400 outline-none",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary",
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
// Plain thin horizontal separator.

interface SketchDividerProps {
  seedId: string;
  accent?: SketchColorKey;
  className?: string;
}

export function SketchDivider({ className }: SketchDividerProps) {
  return (
    <div className={cn("h-px w-full bg-slate-200", className)} />
  );
}
