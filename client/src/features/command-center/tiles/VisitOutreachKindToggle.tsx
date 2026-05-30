import React from "react";
import type { CommandTileKind, CommandTileSurface } from "./commandTileTypes";

const KIND_OPTIONS: { value: CommandTileKind; label: string }[] = [
  { value: "visit", label: "Visit" },
  { value: "outreach", label: "Outreach" },
];

export type VisitOutreachKindToggleProps = {
  surface: CommandTileSurface;
  value: CommandTileKind;
  onChange: (next: CommandTileKind) => void;
  className?: string;
  /**
   * Prefix for the per-button data-testid. Each button is tagged with
   * `${testIdPrefix}-${kind}`. Defaults to `kind-toggle-${surface}` so each
   * surface gets a stable identifier; callers that need backwards-compatible
   * testIds (e.g. `button-plexus-iq-add-type`) should pass their own prefix.
   */
  testIdPrefix?: string;
};

export function VisitOutreachKindToggle({
  surface,
  value,
  onChange,
  className,
  testIdPrefix,
}: VisitOutreachKindToggleProps) {
  const prefix = testIdPrefix ?? `kind-toggle-${surface}`;
  const containerClass = [
    "inline-flex rounded-lg border border-slate-200 overflow-hidden",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={containerClass}
      role="radiogroup"
      data-tile-surface={surface}
      data-kind-toggle-value={value}
    >
      {KIND_OPTIONS.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={`px-3 h-9 text-xs font-medium ${
              isActive
                ? "bg-plexus-navy-800 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
            data-testid={`${prefix}-${option.value}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
