import { type ComponentType, type ReactNode } from "react";

// Shared left-rail tool icon button. Vertical stacking layout: icon
// over label. Used by the Team Portal left tools rail (PCS + ACS).

// Light iOS-style frosted-glass color tints, keyed per dock group.
export type ToolTint = "sky" | "amber" | "emerald" | "violet" | "slate";

const TINT_INACTIVE: Record<ToolTint, string> = {
  sky: "border-sky-200/50 bg-sky-100/40 text-slate-900 hover:bg-sky-100/70",
  amber: "border-amber-200/50 bg-amber-100/40 text-slate-900 hover:bg-amber-100/70",
  emerald: "border-emerald-200/50 bg-emerald-100/40 text-slate-900 hover:bg-emerald-100/70",
  violet: "border-violet-200/50 bg-violet-100/40 text-slate-900 hover:bg-violet-100/70",
  slate: "border-slate-200/50 bg-white/40 text-slate-900 hover:bg-white/70",
};

export type LeftRailToolsButtonProps = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  /** A small unread / count indicator chip rendered in the top-right
   *  corner — e.g. "3" for tasks. */
  badge?: ReactNode;
  /** Icon-only "sticker glass" mode used by the narrow left rail —
   *  hides the label, keeps the icon + badge in a square tile. */
  compact?: boolean;
  /** When true the tile can be dragged onto the Playground surface to
   *  spawn a floating widget. A subtle dashed hover ring hints at it. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void;
  /** Frosted-glass color tint (per dock group). Defaults to slate. */
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={draggable ? `${label} — click to open, drag onto Playground` : label}
      aria-label={label}
      draggable={draggable}
      onDragStart={onDragStart}
      className={[
        "group relative inline-flex flex-col items-center justify-center gap-1 rounded-xl border text-center backdrop-blur-md transition-colors",
        compact ? "aspect-square w-full p-0" : "px-2 py-2",
        active
          ? "border-white/60 bg-white/80 text-slate-900 shadow-[0_4px_18px_rgba(15,23,42,0.18)]"
          : TINT_INACTIVE[tint],
        draggable ? "cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-dashed hover:ring-indigo-300" : "",
      ].join(" ")}
      data-testid={testId}
    >
      <Icon className="h-4 w-4" />
      {!compact && <span className="text-[9px] font-medium leading-tight">{label}</span>}
      {badge ? (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
