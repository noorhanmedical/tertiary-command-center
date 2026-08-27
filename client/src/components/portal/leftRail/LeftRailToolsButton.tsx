import { type ComponentType, type ReactNode } from "react";
import { SketchButton } from "@/components/playground/sketch/SketchPrimitives";
import { SketchBadge } from "@/components/playground/sketch/SketchPrimitives";

// Shared left-rail tool icon button. Vertical stacking layout: icon over
// label. Used by the Team Portal left tools rail (PCS + ACS). SketchUI: each
// tile is a paper sketch button; the per-group "tint" survives as a muted
// colored-pencil accent on the label so the grouping is still legible.
export type ToolTint = "sky" | "amber" | "emerald" | "violet" | "slate";

// Muted colored-pencil accent per dock group (label color).
const TINT_ACCENT: Record<ToolTint, string> = {
  sky: "var(--sketch-blue)",
  amber: "var(--sketch-gold)",
  emerald: "var(--sketch-green)",
  violet: "var(--sketch-violet)",
  slate: "#475569",
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
    <SketchButton
      variant="secondary"
      seedId={`rail-tool-${testId}`}
      active={active}
      onClick={onClick}
      aria-pressed={active}
      title={draggable ? `${label} — click to open, drag onto Playground` : label}
      aria-label={label}
      draggable={draggable}
      onDragStart={onDragStart}
      className={[
        "relative flex-col gap-1 text-center",
        compact ? "aspect-square w-full !px-0 !py-0" : "w-full !px-2 !py-2",
        draggable ? "cursor-grab active:cursor-grabbing" : "",
      ].join(" ")}
      data-testid={testId}
    >
      <span style={{ color: active ? TINT_ACCENT[tint] : undefined }} className="inline-flex">
        <Icon className="h-4 w-4" />
      </span>
      {!compact && (
        <span className="text-[9px] font-medium leading-tight" style={{ color: TINT_ACCENT[tint] }}>
          {label}
        </span>
      )}
      {badge != null ? (
        <span className="absolute -top-1.5 -right-1.5">
          <SketchBadge tone="gold">{badge}</SketchBadge>
        </span>
      ) : null}
    </SketchButton>
  );
}
