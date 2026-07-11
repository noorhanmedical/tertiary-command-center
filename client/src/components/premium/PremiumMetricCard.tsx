import type { ReactNode } from "react";

// Premium metric tile — compact KPI card with eyebrow + large number.
// Use for stat strips next to or under the hero. Presentational only.

type Tone = "default" | "success" | "warning" | "danger" | "info";

const accent: Record<Tone, string> = {
  default: "text-[#475467]",
  success: "text-[#047857]",
  warning: "text-[#B45309]",
  danger: "text-[#BE123C]",
  info: "text-[#1D4ED8]",
};

type PremiumMetricCardProps = {
  icon?: ReactNode;
  label: string;
  value: number | string;
  tone?: Tone;
  testId?: string;
};

export function PremiumMetricCard({
  icon,
  label,
  value,
  tone = "default",
  testId,
}: PremiumMetricCardProps) {
  return (
    <div
      className="bg-white border border-[#DCE2EA] rounded p-4 flex flex-col gap-2"
      data-testid={testId}
    >
      <div className={`inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] ${accent[tone]}`}>
        {icon}
        {label}
      </div>
      <div className="text-[28px] font-light tabular-nums leading-none text-[#101115]">
        {value}
      </div>
    </div>
  );
}
