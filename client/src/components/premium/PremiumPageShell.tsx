import type { ReactNode } from "react";

// Premium page shell used by Plexus IQ. Provides the canonical
// app background (#EEF1F6), full-height column flex, and a scrollable
// main slot. Presentational only — owns no state.

type PremiumPageShellProps = {
  topBar: ReactNode;
  children: ReactNode;
  /** Optional ref for the scrollable main area, used by callers that
   *  need to scrollTo(0,0) on mount. */
  mainRef?: React.Ref<HTMLElement>;
};

export function PremiumPageShell({ topBar, children, mainRef }: PremiumPageShellProps) {
  return (
    <div className="flex flex-col h-full w-full min-w-0 bg-[#EEF1F6]">
      {topBar}
      <main
        ref={mainRef}
        className="flex-1 min-h-0 overflow-auto"
        data-testid="premium-page-shell-main"
      >
        {children}
      </main>
    </div>
  );
}
