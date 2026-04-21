import type { CallBucket } from "./types";

export function MetricTile({
  icon, label, value, accent, badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: string;
  badge?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-white/60 bg-white/85 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl"
      data-testid={`metric-tile-${label.replace(/\s+/g, "-").toLowerCase()}`}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${accent}`}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-slate-900">{value}</span>
        {badge && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" data-testid="metric-tile-badge">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

export function BucketIndicator({ bucket }: { bucket: CallBucket }) {
  const map: Record<CallBucket, { color: string; label: string }> = {
    callback_due:  { color: "bg-amber-400",   label: "Callback due" },
    never_called:  { color: "bg-indigo-400",  label: "New" },
    no_answer:     { color: "bg-slate-400",   label: "No answer" },
    contacted:     { color: "bg-blue-400",    label: "Contacted" },
    scheduled:     { color: "bg-emerald-500", label: "Scheduled" },
    declined:      { color: "bg-rose-400",    label: "Declined" },
  };
  const cfg = map[bucket];
  return (
    <span className="mt-1.5 inline-flex h-2.5 w-2.5 shrink-0 rounded-full" title={cfg.label}>
      <span className={`h-full w-full rounded-full ${cfg.color}`} />
    </span>
  );
}

export function ShortcutRow({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5">
      <span className="text-slate-700">{desc}</span>
      <kbd className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">{k}</kbd>
    </div>
  );
}
