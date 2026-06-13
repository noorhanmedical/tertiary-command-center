import type { ReactNode } from "react";

// Single stat shown inside the right card of a PremiumHero. Light
// weight number, tiny uppercase eyebrow above. Presentational only.

type PremiumHeroStatProps = {
  icon?: ReactNode;
  label: string;
  value: number | string;
  testId?: string;
};

export function PremiumHeroStat({ icon, label, value, testId }: PremiumHeroStatProps) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-white/55">
        {icon && <span className="text-white/70">{icon}</span>}
        {label}
      </div>
      <div className="text-[30px] font-light tabular-nums leading-none text-white">
        {value}
      </div>
    </div>
  );
}

// Convenience grid wrapper used when callers want a 2x2 stat block.
export function PremiumHeroStatGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-6 gap-y-4 rounded border border-white/10 bg-white/[0.04] backdrop-blur-[1px] p-4"
      data-testid="premium-hero-stat-grid"
    >
      {children}
    </div>
  );
}
