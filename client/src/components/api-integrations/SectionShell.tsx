// SectionShell — common chrome for every Integration Station section.
//
// Renders the section title, an optional subtitle, an optional status
// badge, and a body region. Lets the page focus on data + actions
// instead of layout boilerplate.

import { Card } from "@/components/ui/card";
import type { ReactNode } from "react";

export interface SectionShellProps {
  title: string;
  subtitle?: string;
  // Right-aligned status badge slot (e.g., "Backend pending").
  status?: ReactNode;
  // Right-aligned action slot (buttons). Sits beside the status.
  actions?: ReactNode;
  // Body content — typically a Card with a table / form inside.
  children: ReactNode;
  // Testid suffix for the wrapping section element.
  testId?: string;
}

export function SectionShell({
  title,
  subtitle,
  status,
  actions,
  children,
  testId,
}: SectionShellProps) {
  return (
    <section
      className="flex flex-col gap-4"
      data-testid={testId ?? `section-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 leading-tight">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-xs text-slate-500 mt-1 leading-snug">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status}
          {actions}
        </div>
      </header>
      {children}
    </section>
  );
}

// Small KPI card used inside multiple sections (resource counts,
// sync health, etc.). One pattern instead of inline duplicates.
export interface IntegrationKpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  testId?: string;
}

export function IntegrationKpiCard({
  label,
  value,
  hint,
  testId,
}: IntegrationKpiCardProps) {
  return (
    <Card
      className="rounded-xl border-slate-200 p-4"
      data-testid={testId ?? `kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      {hint ? (
        <div className="text-[10px] text-slate-400 mt-1 leading-snug">{hint}</div>
      ) : null}
    </Card>
  );
}
