import { CalendarCheck, Footprints, PhoneCall, Target } from "lucide-react";

// Per-member daily call targets surfaced from the engagement Call Settings
// derived source of truth (GET /api/engagement/call-settings members[].derived).
// Values are NEVER recomputed here — the server-derived completed-call KPI,
// scheduled KPI, and visit/outreach split are passed straight through. Only
// progress (work done so far vs target) is shown alongside them.
export function DailyTargetsTile({
  completedCallKpi,
  scheduledKpi,
  visitTarget,
  outreachTarget,
  callsDone,
  scheduledDone,
}: {
  completedCallKpi: number;
  scheduledKpi: number;
  visitTarget: number;
  outreachTarget: number;
  callsDone: number;
  scheduledDone: number;
}) {
  return (
    <div
      className="pointer-events-auto inline-flex flex-wrap items-center gap-3 rounded-2xl border border-white/70 bg-white/95 px-4 py-2 shadow-[0_8px_30px_rgba(15,23,42,0.10)] backdrop-blur-xl"
      data-testid="portal-daily-targets"
    >
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        <Target className="h-3.5 w-3.5 text-indigo-600" />
        Today's targets
      </span>

      <ProgressStat
        icon={<PhoneCall className="h-3.5 w-3.5 text-blue-600" />}
        label="Calls"
        done={callsDone}
        target={completedCallKpi}
        barClass="bg-blue-500"
        testId="target-completed-calls"
      />
      <ProgressStat
        icon={<CalendarCheck className="h-3.5 w-3.5 text-emerald-600" />}
        label="Scheduled"
        done={scheduledDone}
        target={scheduledKpi}
        barClass="bg-emerald-500"
        testId="target-scheduled"
      />

      <span className="h-5 w-px bg-slate-200" aria-hidden />

      <SplitStat
        icon={<CalendarCheck className="h-3.5 w-3.5 text-sky-600" />}
        label="Visit"
        value={visitTarget}
        testId="target-visit"
      />
      <SplitStat
        icon={<Footprints className="h-3.5 w-3.5 text-violet-600" />}
        label="Outreach"
        value={outreachTarget}
        testId="target-outreach"
      />
    </div>
  );
}

function ProgressStat({
  icon,
  label,
  done,
  target,
  barClass,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  done: number;
  target: number;
  barClass: string;
  testId: string;
}) {
  const pct =
    target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const met = target > 0 && done >= target;
  return (
    <div className="flex items-center gap-1.5" data-testid={testId}>
      <span>{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900" data-testid={`${testId}-value`}>
        {done}
        <span className="text-slate-400">/{target}</span>
      </span>
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${met ? "bg-emerald-500" : barClass}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

function SplitStat({
  icon,
  label,
  value,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-1.5" data-testid={testId}>
      <span>{icon}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900" data-testid={`${testId}-value`}>
        {value}
      </span>
    </div>
  );
}
