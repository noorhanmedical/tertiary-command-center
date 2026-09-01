import * as React from "react";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════════════════════════════
   PLEXUS WINTER UI — KPI / metric system (§52, §64)
   Prefer compact MetricStrip for secondary page metrics; MetricCard only for
   analytics dashboards.
   ══════════════════════════════════════════════════════════════════════ */

export interface MetricProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  delta?: { value: string; direction: "up" | "down"; positive?: boolean };
}

/** Single metric cell (§52). Value 28–34px, label 10–11px, delta 12px. */
export function Metric({ label, value, icon: Icon, delta }: MetricProps) {
  const deltaColor = delta
    ? (delta.positive ?? delta.direction === "up")
      ? "var(--w-green)"
      : "var(--w-error)"
    : undefined;
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <span className="plexus-icon-frost h-10 w-10" aria-hidden>
          <Icon className="size-5 text-[var(--w-blue)]" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--w-text-muted)" }}>
          {label}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-[30px] leading-none" style={{ fontWeight: 600, color: "var(--w-text)" }}>
            {value}
          </span>
          {delta && (
            <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold" style={{ color: deltaColor }}>
              <DeltaIcon className="size-3.5" aria-hidden />
              {delta.value}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** MetricStrip (§52, §64) — compact row of metrics inside one frosted panel. */
export function MetricStrip({
  metrics,
  className,
}: {
  metrics: MetricProps[];
  className?: string;
}) {
  return (
    <div
      className={cn("plexus-frost flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-5", className)}
      data-testid="plexus-metric-strip"
    >
      {metrics.map((m, i) => (
        <React.Fragment key={m.label}>
          {i > 0 && <span className="hidden h-10 w-px self-center bg-[var(--w-divider)] md:block" aria-hidden />}
          <Metric {...m} />
        </React.Fragment>
      ))}
    </div>
  );
}

/** MetricCard (§52) — for analytics dashboards where a large card is warranted. */
export function MetricCard({ label, value, icon, delta, className }: MetricProps & { className?: string }) {
  return (
    <div className={cn("plexus-card p-5", className)} data-testid="plexus-metric-card">
      <Metric label={label} value={value} icon={icon} delta={delta} />
    </div>
  );
}

/** ProgressBar (§50) — determinate/indeterminate, blue accent. */
export function ProgressBar({
  value,
  indeterminate,
  showPercent,
  className,
  label,
}: {
  value?: number;
  indeterminate?: boolean;
  showPercent?: boolean;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={cn("w-full", className)}>
      {(label || showPercent) && (
        <div className="mb-1.5 flex items-center justify-between text-[12px]" style={{ color: "var(--w-text-2)" }}>
          <span>{label}</span>
          {showPercent && !indeterminate && <span>{pct}%</span>}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--w-blue-soft)]"
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full bg-[var(--w-blue)]", indeterminate && "w-1/3 animate-[plexus-indeterminate_1.4s_ease_infinite]")}
          style={indeterminate ? undefined : { width: `${pct}%`, transition: "width 200ms ease" }}
        />
      </div>
    </div>
  );
}
