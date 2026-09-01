import { type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared left-rail tool tile. Square / cube-like: icon centered over a compact
// label, consistent dimensions, rounded corners, clean glass surface with a
// clear hover + focus state and an active (selected) state. The per-group
// "tint" survives as a subtle colored accent on the active tile + icon so the
// grouping is still legible.
export type ToolTint = "sky" | "amber" | "emerald" | "violet" | "slate";

// Muted accent per dock group (icon + active tint).
const TINT_ACCENT: Record<ToolTint, string> = {
  sky: "#3b6fb0",
  amber: "#b0812f",
  emerald: "#3f8f6b",
  violet: "#6d5aa0",
  slate: "#475569",
};

export type LeftRailToolsButtonProps = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  /** A small unread / count indicator chip rendered in the top-right corner. */
  badge?: ReactNode;
  /** Icon-only square tile used by the narrow left rail — hides the label. */
  compact?: boolean;
  /** When true the tile can be dragged onto the Playground surface to spawn a
   *  floating widget. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void;
  /** Color tint (per dock group). Defaults to slate. */
  tint?: ToolTint;
  testId: string;
};

export function LeftRailToolsButton({
  label,
  icon: Icon,
  active,
  onClick,
  badge,
  compact = false,
  draggable = false,
  onDragStart,
  tint = "slate",
  testId,
}: LeftRailToolsButtonProps) {
  const accent = TINT_ACCENT[tint];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={draggable ? `${label} — click to open, drag onto Playground` : label}
      aria-label={label}
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid={testId}
      className={cn(
        // Compact square-ish tile. A capped height (not a strict square) keeps
        // the whole dock + calendar within the rail without scrolling.
        "group relative flex aspect-square max-h-[64px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center",
        "outline-none transition-all duration-150",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-blue)] focus-visible:ring-offset-1",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        active
          ? "border-transparent bg-white shadow-sm ring-1 ring-[color:var(--sketch-blue)]/40"
          : "border-white/60 bg-white/55 hover:bg-white/85 hover:shadow-sm",
      )}
      style={{ boxShadow: active ? undefined : "0 1px 2px rgba(58,96,150,0.08)" }}
    >
      <span className="inline-flex" style={{ color: active ? accent : "#64748b" }}>
        <Icon className={compact ? "h-5 w-5" : "h-[1.2rem] w-[1.2rem]"} />
      </span>
      {!compact && (
        <span
          className="w-full truncate text-[9px] font-semibold leading-tight"
          style={{ color: active ? accent : "#475569" }}
        >
          {label}
        </span>
      )}
      {badge != null ? (
        <span
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[color:var(--sketch-blue)] px-1 text-[9px] font-semibold text-white shadow-sm"
          data-testid={`${testId}-badge`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
