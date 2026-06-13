import type { ReactNode } from "react";

// Premium clinical card — generic wrapper meant to surround a
// patient-card-style body. Drops the busy gradient banners in favor
// of a calm white surface, a thin dark accent stripe along the left
// edge when the caller flags an alert state, and a single header row
// for primary identity. Presentational only.

type PremiumClinicalCardProps = {
  children: ReactNode;
  /** When `alert` is true, the left accent stripe shifts to the
   *  Admin Review purple to signal the row needs review. */
  alert?: boolean;
  /** Whole-card click — keeps the existing "click card opens edit"
   *  contract intact for migrating consumers. */
  onClick?: () => void;
  testId?: string;
  className?: string;
};

export function PremiumClinicalCard({
  children,
  alert = false,
  onClick,
  testId,
  className = "",
}: PremiumClinicalCardProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={[
        "relative overflow-hidden bg-white border border-[#DCE2EA] rounded",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        onClick
          ? "cursor-pointer hover:shadow-[0_4px_14px_rgba(15,23,42,0.08)] hover:border-[#C7D0DD] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]/30"
          : "",
        className,
      ].join(" ")}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${
          alert ? "bg-[#7C3AED]" : "bg-transparent"
        }`}
      />
      {children}
    </div>
  );
}
