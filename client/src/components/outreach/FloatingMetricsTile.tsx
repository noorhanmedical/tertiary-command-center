import { CalendarCheck, Phone, PhoneCall, TrendingUp } from "lucide-react";

export function FloatingMetricsTile({
  callsMade, reachedCount, scheduledFromCalls, conversionPct, callbacksDue,
}: {
  callsMade: number;
  reachedCount: number;
  scheduledFromCalls: number;
  conversionPct: number;
  callbacksDue: number;
}) {
  return (
    <div
      className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/95 px-4 py-2 shadow-[0_8px_30px_rgba(15,23,42,0.10)] backdrop-blur-xl"
      data-testid="portal-floating-metrics"
    >
      <Stat icon={<Phone className="h-3.5 w-3.5 text-blue-600" />} label="Calls" value={callsMade} />
      <Stat icon={<PhoneCall className="h-3.5 w-3.5 text-violet-600" />} label="Reached" value={reachedCount} />
      <Stat icon={<CalendarCheck className="h-3.5 w-3.5 text-emerald-600" />} label="Booked" value={scheduledFromCalls} />
      <Stat icon={<TrendingUp className="h-3.5 w-3.5 text-amber-600" />} label="Conv" value={`${conversionPct}%`} />
      {callbacksDue > 0 && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          {callbacksDue} callback{callbacksDue !== 1 ? "s" : ""} due
        </span>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-1.5" data-testid={`metric-${label.toLowerCase()}`}>
      <span>{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}
