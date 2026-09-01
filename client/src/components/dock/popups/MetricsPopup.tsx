// Metrics dock popup — compact floating KPI panel.
//
// Shows role-aware daily metrics at a glance. Designed as a quick
// interaction surface; "Open in Playground" defers to a future full
// analytics workspace.

import { X, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MetricsPopupProps = {
  open: boolean;
  onClose: () => void;
  onOpenInPlayground?: () => void;
  /** Role-specific metrics. */
  metrics?: {
    callsToday?: number;
    scheduledToday?: number;
    tasksDue?: number;
    queueCount?: number;
    completedWork?: number;
    kpiProgress?: number; // 0–100
  };
  className?: string;
};

function MetricTile({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "emerald" | "amber" | "rose" | "indigo" | "slate" }) {
  const toneColor: Record<string, string> = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
    indigo: "text-indigo-600",
    slate: "text-slate-900",
  };
  return (
    <div className="rounded-xl bg-slate-50/80 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${toneColor[tone]}`}>{value}</div>
    </div>
  );
}

export function MetricsPopup({ open, onClose, onOpenInPlayground, metrics, className = "" }: MetricsPopupProps) {
  if (!open) return null;

  const m = metrics ?? {};

  return (
    <div
      className={`w-[300px] rounded-[20px] border border-slate-200/80 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl ${className}`}
      data-testid="metrics-popup"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">Today's Metrics</span>
        </div>
        <div className="flex items-center gap-1">
          {onOpenInPlayground && (
            <button type="button" onClick={onOpenInPlayground} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100" title="Open in Playground" data-testid="metrics-open-playground">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100" data-testid="metrics-popup-close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        <MetricTile label="Calls Today" value={m.callsToday ?? 0} tone="indigo" />
        <MetricTile label="Scheduled" value={m.scheduledToday ?? 0} tone="emerald" />
        <MetricTile label="Tasks Due" value={m.tasksDue ?? 0} tone="amber" />
        <MetricTile label="Queue" value={m.queueCount ?? 0} tone="slate" />
        <MetricTile label="Completed" value={m.completedWork ?? 0} tone="emerald" />
        <MetricTile label="KPI Progress" value={m.kpiProgress != null ? `${m.kpiProgress}%` : "—"} tone={m.kpiProgress != null && m.kpiProgress >= 80 ? "emerald" : "amber"} />
      </div>
      {onOpenInPlayground && (
        <div className="border-t border-slate-100 px-4 py-2.5">
          <Button size="sm" variant="ghost" className="w-full h-7 gap-1.5 text-[11px] text-slate-600 hover:text-slate-800" onClick={onOpenInPlayground} data-testid="metrics-expand-playground">
            <Maximize2 className="h-3 w-3" /> Full Analytics
          </Button>
        </div>
      )}
    </div>
  );
}
