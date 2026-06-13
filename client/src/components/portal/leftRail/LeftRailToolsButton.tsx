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
  testId: string;
};

export function LeftRailToolsButton({
  label,
  icon: Icon,
  active,
  onClick,
  badge,
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
        "relative inline-flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center transition-colors",
        active
          ? "border-white/40 bg-white text-slate-900 shadow-sm"
          : "border-white/15 bg-white/85 text-slate-900 hover:bg-white",
      ].join(" ")}
      data-testid={testId}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[9px] font-medium leading-tight">{label}</span>
      {badge ? (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
