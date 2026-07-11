import type { ReactNode } from "react";

// Premium dark hero (NOT a duplicate H1). Renders below the
// PremiumTopBar to introduce the workspace identity, value prop,
// and key actions. Background uses the approved gradient
// #0D0E12 → #171B26 → #2A3D5A and overlays a subtle grid pattern.
// Presentational only — no data fetching, no mutations.

type PremiumHeroProps = {
  eyebrow?: string;
  title: string;
  copy?: string;
  actions?: ReactNode;
  /** Right-side stat slot (typically a grid of PremiumHeroStat). */
  statusCard?: ReactNode;
  testId?: string;
};

export function PremiumHero({
  eyebrow,
  title,
  copy,
  actions,
  statusCard,
  testId = "premium-hero",
}: PremiumHeroProps) {
  return (
    <section
      className="relative overflow-hidden bg-gradient-to-br from-[#0D0E12] via-[#171B26] to-[#2A3D5A] text-white"
      data-testid={testId}
      aria-label="Workspace summary"
    >
      {/* Subtle grid wash. Inline SVG would also work; the linear-
          gradient pair below avoids a network round-trip. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Soft radial highlight in the upper-right adds depth without
          competing with the right status card. */}
      <div
        aria-hidden
        className="absolute -top-24 right-[-10%] h-[420px] w-[420px] rounded-full opacity-[0.18] pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(124,58,237,0.6), transparent 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-[1400px] px-6 sm:px-8 lg:px-10 xl:px-12 py-10 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 items-start">
          <div className="space-y-5 max-w-2xl">
            {eyebrow && (
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
                {eyebrow}
              </div>
            )}
            <h2 className="text-[44px] sm:text-[52px] lg:text-[60px] leading-[1.02] font-light tracking-[-0.055em] text-white">
              {title}
            </h2>
            {copy && (
              <p className="text-[14px] sm:text-[15px] leading-relaxed text-white/65 font-light max-w-[58ch]">
                {copy}
              </p>
            )}
            {actions && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {actions}
              </div>
            )}
          </div>
          {statusCard && (
            <div className="lg:min-w-[300px]">
              {statusCard}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
