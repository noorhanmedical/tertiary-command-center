import type { ReactNode } from "react";

// Premium data card — the canonical clickable card for tiles (facility
// tiles, add-patient hub tiles, etc.). White surface, 1px #DCE2EA
// border, 6px radius, subtle hairline shadow, premium hover lift.
// Presentational only — no data fetching, no business logic.

type PremiumDataCardProps = {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  /** Optional element-level data attributes for QA. */
  testId?: string;
  ariaLabel?: string;
  disabled?: boolean;
};

export function PremiumDataCard({
  onClick,
  children,
  className = "",
  testId,
  ariaLabel,
  disabled,
}: PremiumDataCardProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={[
          "group block w-full text-left bg-white border border-[#DCE2EA] rounded",
          "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          "hover:shadow-[0_4px_14px_rgba(15,23,42,0.08)] hover:border-[#C7D0DD]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]/30",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-all duration-150",
          className,
        ].join(" ")}
        data-testid={testId}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={[
        "bg-white border border-[#DCE2EA] rounded shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      ].join(" ")}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
