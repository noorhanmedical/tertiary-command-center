import { type ComponentType, type ReactNode } from "react";

// Shared left-rail tool icon button. Vertical stacking layout: icon
// over label. Used by the Team Portal left tools rail (PCS + ACS).

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
  testId: string;
};

export function LeftRailToolsButton({
  label,
  icon: Icon,
  active,
  onClick,
  badge,
  compact = false,
  testId,
}: LeftRailToolsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      aria-label={label}
      className={[
        "group relative inline-flex flex-col items-center justify-center gap-1 rounded-xl border text-center backdrop-blur-md transition-colors",
        compact ? "aspect-square w-full p-0" : "px-2 py-2",
        active
          ? "border-white/50 bg-white/70 text-slate-900 shadow-[0_4px_18px_rgba(15,23,42,0.18)]"
          : "border-white/30 bg-white/30 text-slate-900 hover:bg-white/55",
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
