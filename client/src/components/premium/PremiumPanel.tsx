import type { ReactNode } from "react";

// Premium white panel — the default content surface. White bg,
// 1px #DCE2EA border, 6px radius, subtle hairline shadow. The
// `title` + `eyebrow` slots make it usable as a section header
// container without ad-hoc copies.

type PremiumPanelProps = {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  trailing?: ReactNode;
  className?: string;
  testId?: string;
};

export function PremiumPanel({
  children,
  eyebrow,
  title,
  trailing,
  className = "",
  testId,
}: PremiumPanelProps) {
  return (
    <section
      className={`bg-white border border-[#DCE2EA] rounded shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
      data-testid={testId}
    >
      {(eyebrow || title || trailing) && (
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-[#EEF1F5]">
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#667085]">
                {eyebrow}
              </div>
            )}
            {title && (
              <div className="text-[16px] font-medium text-[#111827] truncate">
                {title}
              </div>
            )}
          </div>
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
