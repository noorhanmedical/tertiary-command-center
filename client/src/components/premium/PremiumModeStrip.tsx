import type { ReactNode } from "react";

// Mode strip — used for the clinic-interior status filter and
// similar segmented selectors. One mode is active at any time;
// click switches the active mode via the supplied onSelect.

export type PremiumMode<TId extends string = string> = {
  id: TId;
  label: string;
  count?: number;
  icon?: ReactNode;
  /** Optional per-mode test id override. The strip falls back to
   *  `plexus-iq-clinic-status-tile-<id>` for backward compatibility
   *  with existing QA selectors. */
  testId?: string;
};

type PremiumModeStripProps<TId extends string> = {
  modes: ReadonlyArray<PremiumMode<TId>>;
  activeId: TId;
  onSelect: (id: TId) => void;
  /** Test id placed on the container. */
  testId?: string;
  /** Override the per-mode test id pattern. Defaults to
   *  `plexus-iq-clinic-status-tile-<id>` for current callers. */
  modeTestIdPrefix?: string;
};

export function PremiumModeStrip<TId extends string>({
  modes,
  activeId,
  onSelect,
  testId = "premium-mode-strip",
  modeTestIdPrefix = "plexus-iq-clinic-status-tile-",
}: PremiumModeStripProps<TId>) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      data-testid={testId}
    >
      {modes.map((m) => {
        const active = m.id === activeId;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className={[
              "group flex items-center justify-between gap-2 px-3 py-2.5 rounded border text-left transition-colors",
              active
                ? "bg-[#101115] border-[#101115] text-white"
                : "bg-white border-[#DCE2EA] text-[#475467] hover:bg-[#F8F9FB] hover:border-[#C7D0DD]",
            ].join(" ")}
            data-testid={m.testId ?? `${modeTestIdPrefix}${m.id}`}
            aria-pressed={active}
          >
            <span className="flex flex-col gap-1 min-w-0">
              <span className="text-[10px] uppercase tracking-[0.16em] opacity-80 truncate">
                {m.label}
              </span>
              {typeof m.count === "number" && (
                <span className="text-[20px] font-light tabular-nums leading-none">
                  {m.count}
                </span>
              )}
            </span>
            {m.icon && (
              <span className={active ? "text-white/70" : "text-[#9AA3B2]"}>
                {m.icon}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
