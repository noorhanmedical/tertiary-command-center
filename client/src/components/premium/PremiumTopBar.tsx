import type { ReactNode } from "react";

// Dark premium top bar (canonical H1 surface for Plexus IQ).
// Background #101115, 80px tall, white text. Slots for left (sidebar
// trigger + title + subtitle) and right (action buttons). Presentational.

type PremiumTopBarProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  /** Test id placed on the root header element. Defaults to
   *  `premium-top-bar`. Replace with the legacy id when migrating an
   *  existing surface. */
  testId?: string;
  /** If the consuming page wants to attach the title to a specific
   *  data-testid (e.g. `text-plexus-iq-title`), pass it here. */
  titleTestId?: string;
};

export function PremiumTopBar({
  title,
  subtitle,
  leading,
  actions,
  testId = "premium-top-bar",
  titleTestId,
}: PremiumTopBarProps) {
  return (
    <header
      className="bg-[#101115] border-b border-black/20 sticky top-0 z-30"
      data-testid={testId}
    >
      <div className="mx-auto w-full max-w-[1400px] px-6 sm:px-8 lg:px-10 xl:px-12 h-20 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {leading && (
            <span className="inline-flex items-center text-white/80 [&_svg]:text-white/80">
              {leading}
            </span>
          )}
          <div className="min-w-0">
            <h1
              className="text-[16px] font-medium tracking-tight text-white truncate"
              data-testid={titleTestId}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-white/50 leading-tight truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
