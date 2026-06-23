import { Brain, HeartPulse, Phone, Waves, Activity, DollarSign } from "lucide-react";
import {
  useHomeStats,
  type HomeWindowStat,
  type HomeMemberCallStat,
} from "@/hooks/api/home-stats";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type WindowKey = keyof HomeWindowStat;

function MetricStat({
  label,
  icon,
  testId,
  today,
  last7,
  last30,
  windowKey,
  headlineOverride,
  bodyOverride,
  upcomingNode,
}: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  today?: HomeWindowStat;
  last7?: HomeWindowStat;
  last30?: HomeWindowStat;
  windowKey?: WindowKey;
  headlineOverride?: React.ReactNode;
  bodyOverride?: React.ReactNode;
  upcomingNode?: React.ReactNode;
}) {
  const headline = headlineOverride ?? (windowKey ? last7?.[windowKey] ?? 0 : 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} (last 7 days)`}
          title={`${label} · last 7 days`}
          className="group flex flex-col items-center gap-2 rounded-xl px-4 py-3 transition-colors hover:bg-indigo-500/10 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
          data-testid={testId}
        >
          <span className="shrink-0">{icon}</span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white tabular-nums leading-none tracking-tight">
              {headline}
            </span>
            {upcomingNode}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-56"
        data-testid={`${testId}-popover`}
      >
        <div className="text-[12px] font-semibold text-slate-900 dark:text-foreground mb-2">
          {label}
        </div>
        {bodyOverride ?? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-muted-foreground">Today</span>
              <span
                className="font-semibold tabular-nums text-slate-900 dark:text-foreground"
                data-testid={`${testId}-today`}
              >
                {(windowKey ? today?.[windowKey] : 0) ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-muted-foreground">Last 7 days</span>
              <span
                className="font-semibold tabular-nums text-slate-900 dark:text-foreground"
                data-testid={`${testId}-last7`}
              >
                {(windowKey ? last7?.[windowKey] : 0) ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500 dark:text-muted-foreground">Last 30 days</span>
              <span
                className="font-semibold tabular-nums text-slate-900 dark:text-foreground"
                data-testid={`${testId}-last30`}
              >
                {(windowKey ? last30?.[windowKey] : 0) ?? 0}
              </span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CallMemberList({
  title,
  members,
  testId,
}: {
  title: string;
  members: HomeMemberCallStat[];
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-muted-foreground mb-1">
        {title}
      </div>
      {members.length === 0 ? (
        <div className="text-[12px] text-slate-400 dark:text-muted-foreground">
          No calls logged
        </div>
      ) : (
        <div className="space-y-1">
          {members.map((m) => (
            <div
              key={m.name}
              className="flex items-center justify-between text-[12px]"
              data-testid={`${testId}-row-${m.name}`}
            >
              <span className="truncate text-slate-600 dark:text-muted-foreground pr-2">
                {m.name}
              </span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-foreground">
                {m.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AncillaryStat({
  label,
  value,
  upcoming,
  icon,
  testId,
}: {
  label: string;
  value: number;
  upcoming?: number;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-1.5"
      aria-label={`${label} (last 7 days)`}
      title={`${label} · last 7 days`}
      data-testid={testId}
    >
      {icon}
      <span className="flex flex-col items-center leading-none">
        <span className="text-2xl md:text-3xl font-bold tabular-nums text-slate-900 dark:text-white leading-none tracking-tight">
          {value}
        </span>
        {upcoming !== undefined && (
          <span
            className="mt-1 text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums leading-none"
            title={`${upcoming} scheduled in the next 7 days`}
            aria-label={`${upcoming} scheduled in the next 7 days`}
            data-testid={`${testId}-upcoming`}
          >
            {upcoming}
          </span>
        )}
      </span>
    </div>
  );
}

function PracticePulseHeading() {
  return (
    <div className="mb-5 flex items-center justify-center gap-2" data-testid="practice-pulse-heading">
      <Activity className="w-4 h-4 text-indigo-500 dark:text-indigo-300" strokeWidth={2.25} />
      <span className="text-sm md:text-base font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-200">
        Practice Pulse
      </span>
    </div>
  );
}

function UpcomingBadge({
  children,
  testId,
  label,
}: {
  children: React.ReactNode;
  testId: string;
  label: string;
}) {
  return (
    <span
      className="text-base md:text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums leading-none"
      title={label}
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/** Whole-dollar currency, e.g. 4820 → "$4,820". */
function formatDollars(value: number): string {
  return (value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

const TILE_CLASS =
  "rounded-2xl border border-indigo-100/80 dark:border-indigo-400/10 bg-gradient-to-br from-indigo-50 via-white to-sky-50 dark:from-indigo-950/30 dark:via-background dark:to-slate-900/40 ring-1 ring-inset ring-white/40 dark:ring-white/5 shadow-[0_8px_30px_-12px_rgba(79,70,229,0.25)] px-6 py-7 md:px-10 md:py-9";

export function HomeLiveDashboard() {
  const { data, isLoading } = useHomeStats();

  if (isLoading) {
    return (
      <div className={TILE_CLASS} data-testid="live-dashboard-loading">
        <PracticePulseHeading />
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-6 md:gap-x-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`tile-${i}`}
              className="h-[88px] w-[96px] rounded-xl bg-indigo-100/60 dark:bg-muted/40 animate-pulse"
            />
          ))}
          <div
            className="mx-1 md:mx-3 h-12 w-px self-center bg-indigo-200/70 dark:bg-border"
            aria-hidden="true"
          />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={`icon-${i}`}
              className="h-[68px] w-[48px] rounded-xl bg-indigo-100/60 dark:bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const todayStat = data?.windows.today;
  const last7 = data?.windows.last7;
  const last30 = data?.windows.last30;
  const upcoming = data?.upcoming;
  const breakdown = data?.ancillaryBreakdown;
  const callsByMember = data?.callsByMember;

  const finance = data?.finance;
  const callsDistributed = upcoming?.callsDistributed ?? 0;
  const financeLast7 = finance?.last7 ?? 0;
  const financeUpcoming = finance?.upcoming ?? 0;

  return (
    <div className={TILE_CLASS} data-testid="live-dashboard">
      <PracticePulseHeading />
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-6 md:gap-x-4">
        <MetricStat
          label="Ancillaries"
          icon={<Activity className="w-8 h-8 md:w-9 md:h-9 text-slate-900 dark:text-white" strokeWidth={1.75} />}
          testId="stat-total-ancillaries"
          today={todayStat}
          last7={last7}
          last30={last30}
          windowKey="ancillaries"
          upcomingNode={
            <UpcomingBadge
              testId="stat-total-ancillaries-upcoming"
              label={`${upcoming?.ancillaryPatients ?? 0} patients scheduled for ancillaries in the next 7 days`}
            >
              {upcoming?.ancillaryPatients ?? 0}
            </UpcomingBadge>
          }
        />
        <MetricStat
          label="Calls"
          icon={<Phone className="w-8 h-8 md:w-9 md:h-9 text-slate-900 dark:text-white" strokeWidth={1.75} />}
          testId="stat-calls-planned"
          today={todayStat}
          last7={last7}
          last30={last30}
          windowKey="callsPlanned"
          upcomingNode={
            <UpcomingBadge
              testId="stat-calls-planned-upcoming"
              label={`${callsDistributed} anticipated calls in the next 7 days`}
            >
              {callsDistributed}
            </UpcomingBadge>
          }
          bodyOverride={
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-500 dark:text-muted-foreground">
                  Planned today
                </span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-foreground">
                  {todayStat?.callsPlanned ?? 0}
                </span>
              </div>
              <div className="pt-3 border-t border-slate-200/70 dark:border-border space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-muted-foreground">
                  Calls logged
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-500 dark:text-muted-foreground">Last 7 days</span>
                  <span
                    className="font-semibold tabular-nums text-slate-900 dark:text-foreground"
                    data-testid="stat-calls-planned-last7"
                  >
                    {last7?.callsPlanned ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-500 dark:text-muted-foreground">Last 30 days</span>
                  <span
                    className="font-semibold tabular-nums text-slate-900 dark:text-foreground"
                    data-testid="stat-calls-planned-last30"
                  >
                    {last30?.callsPlanned ?? 0}
                  </span>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200/70 dark:border-border space-y-3">
                <CallMemberList
                  title="Logged by member · 7 days"
                  members={callsByMember?.last7 ?? []}
                  testId="calls-by-member-7"
                />
                <CallMemberList
                  title="Logged by member · 30 days"
                  members={callsByMember?.last30 ?? []}
                  testId="calls-by-member-30"
                />
              </div>
            </div>
          }
        />
        <MetricStat
          label="Finances"
          icon={<DollarSign className="w-8 h-8 md:w-9 md:h-9 text-slate-900 dark:text-white" strokeWidth={1.75} />}
          testId="stat-finances"
          windowKey="patients"
          headlineOverride={
            <span data-testid="stat-finances-collected">{formatDollars(financeLast7)}</span>
          }
          upcomingNode={
            <UpcomingBadge
              testId="stat-finances-upcoming"
              label={`${formatDollars(financeUpcoming)} anticipated revenue in the next 7 days`}
            >
              {formatDollars(financeUpcoming)}
            </UpcomingBadge>
          }
          bodyOverride={
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-500 dark:text-muted-foreground">
                  Collected · last 7 days
                </span>
                <span
                  className="font-semibold tabular-nums text-slate-900 dark:text-foreground"
                  data-testid="stat-finances-last7"
                >
                  {formatDollars(financeLast7)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-slate-500 dark:text-muted-foreground">
                  Anticipated · next 7 days
                </span>
                <span
                  className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                  data-testid="stat-finances-anticipated"
                >
                  {formatDollars(financeUpcoming)}
                </span>
              </div>
            </div>
          }
        />

        <div
          className="mx-1 md:mx-3 h-12 w-px self-center bg-indigo-200/70 dark:bg-border"
          aria-hidden="true"
        />

        <div
          className="flex items-center gap-6 md:gap-8 px-2"
          data-testid="live-dashboard-system-ancillaries"
        >
          <AncillaryStat
            label="BrainWave"
            value={breakdown?.brainWave ?? 0}
            upcoming={breakdown?.brainWaveUpcoming ?? 0}
            icon={<Brain className="w-6 h-6 md:w-7 md:h-7 text-slate-900 dark:text-white" strokeWidth={2} />}
            testId="ancillary-brainwave"
          />
          <AncillaryStat
            label="VitalWave"
            value={breakdown?.vitalWave ?? 0}
            upcoming={breakdown?.vitalWaveUpcoming ?? 0}
            icon={<HeartPulse className="w-6 h-6 md:w-7 md:h-7 text-slate-900 dark:text-white" strokeWidth={2} />}
            testId="ancillary-vitalwave"
          />
          <AncillaryStat
            label="Ultrasound"
            value={breakdown?.ultrasound ?? 0}
            upcoming={breakdown?.ultrasoundUpcoming ?? 0}
            icon={<Waves className="w-6 h-6 md:w-7 md:h-7 text-slate-900 dark:text-white" strokeWidth={2} />}
            testId="ancillary-ultrasound"
          />
        </div>
      </div>
    </div>
  );
}
