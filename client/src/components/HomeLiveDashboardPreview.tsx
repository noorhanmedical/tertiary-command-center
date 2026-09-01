// Winter / Alpine Practice Pulse (spec redesign). Visual-layer-only: the KPI
// row is presented as six winter KPI groups — Patients, Calls, Revenue,
// BrainWave, VitalWave, Ultrasound — inside a single frosted `.winter-panel`.
// All data comes from useHomeStats(); no new endpoints, no fabricated deltas
// (the green accent reuses the existing "next 7 days" upcoming figures). The
// three primary KPIs keep their detail popovers (Today / 7d / 30d).
import { Brain, HeartPulse, Waves, Activity, Phone, Users, DollarSign } from "lucide-react";
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

/** Whole-dollar currency, e.g. 4820 → "$4,820". */
function formatDollars(value: number): string {
  return (value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Shared winter KPI presentation: frosted icon circle, value, green accent,
 *  uppercase label. `as` lets the primary KPIs render as a popover trigger. */
function KpiGroup({
  icon,
  value,
  accent,
  accentLabel,
  label,
  accentTestId,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  accent?: React.ReactNode;
  accentLabel?: string;
  label: string;
  accentTestId?: string;
}) {
  return (
    <span className="flex flex-col items-center gap-2 px-3 md:px-5">
      <span className="winter-icon-frost">{icon}</span>
      <span className="flex items-baseline gap-1.5 leading-none">
        <span
          className="text-[28px] md:text-[32px] font-semibold tabular-nums tracking-tight leading-none"
          style={{ color: "var(--w-text)" }}
        >
          {value}
        </span>
        {accent !== undefined && (
          <span
            className="text-[12px] font-semibold tabular-nums leading-none"
            style={{ color: "var(--w-green)" }}
            title={accentLabel}
            aria-label={accentLabel}
            data-testid={accentTestId}
          >
            {accent}
          </span>
        )}
      </span>
      <span
        className="text-[11px] font-semibold uppercase tracking-[0.08em] leading-none"
        style={{ color: "var(--w-text-2)" }}
      >
        {label}
      </span>
    </span>
  );
}

/** Primary KPI (Patients / Calls / Revenue) — KpiGroup wrapped in a detail
 *  popover that keeps the existing Today / 7d / 30d breakdown behavior. */
function MetricKpi({
  label,
  icon,
  testId,
  today,
  last7,
  last30,
  windowKey,
  value,
  accent,
  accentLabel,
  accentTestId,
  bodyOverride,
}: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  today?: HomeWindowStat;
  last7?: HomeWindowStat;
  last30?: HomeWindowStat;
  windowKey?: WindowKey;
  value: React.ReactNode;
  accent?: React.ReactNode;
  accentLabel?: string;
  accentTestId?: string;
  bodyOverride?: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} (last 7 days)`}
          title={`${label} · last 7 days`}
          className="rounded-xl py-2 transition-colors hover:bg-white/50 focus:outline-none"
          data-testid={testId}
        >
          <KpiGroup
            icon={icon}
            value={value}
            accent={accent}
            accentLabel={accentLabel}
            accentTestId={accentTestId}
            label={label}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-56 winter-panel-soft"
        data-testid={`${testId}-popover`}
      >
        <div
          className="text-[12px] font-semibold mb-2"
          style={{ color: "var(--w-text)" }}
        >
          {label}
        </div>
        {bodyOverride ?? (
          <div className="space-y-1.5">
            {(["today", "last7", "last30"] as const).map((k, i) => (
              <div key={k} className="flex items-center justify-between text-[12px]">
                <span style={{ color: "var(--w-text-2)" }}>
                  {i === 0 ? "Today" : i === 1 ? "Last 7 days" : "Last 30 days"}
                </span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: "var(--w-text)" }}
                  data-testid={`${testId}-${k}`}
                >
                  {(windowKey
                    ? (k === "today" ? today : k === "last7" ? last7 : last30)?.[windowKey]
                    : 0) ?? 0}
                </span>
              </div>
            ))}
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
      <div
        className="text-[11px] uppercase tracking-wide mb-1"
        style={{ color: "var(--w-text-muted)" }}
      >
        {title}
      </div>
      {members.length === 0 ? (
        <div className="text-[12px]" style={{ color: "var(--w-text-muted)" }}>
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
              <span className="truncate pr-2" style={{ color: "var(--w-text-2)" }}>
                {m.name}
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ color: "var(--w-text)" }}
              >
                {m.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KPI_ICON = "w-6 h-6";
const KPI_ICON_STYLE = { color: "var(--w-blue)" } as const;

function PracticePulseHeading() {
  return (
    <div className="mb-6 flex items-center gap-2" data-testid="practice-pulse-heading">
      <Activity className="w-4 h-4" style={KPI_ICON_STYLE} strokeWidth={2.25} />
      <span
        className="text-[16px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: "var(--w-text)" }}
      >
        Practice Pulse
      </span>
      <span
        className="ml-2 text-[11px]"
        style={{ color: "var(--w-text-muted)" }}
      >
        Today at a glance
      </span>
    </div>
  );
}

const PANEL_CLASS = "winter-panel px-6 py-6 md:px-8";

export function HomeLiveDashboardPreview() {
  const { data, isLoading } = useHomeStats();

  if (isLoading) {
    return (
      <div className={PANEL_CLASS} data-testid="live-dashboard-loading">
        <PracticePulseHeading />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`kpi-${i}`}
              className="h-[92px] w-[92px] rounded-xl bg-white/50 animate-pulse"
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
    <div className={PANEL_CLASS} data-testid="live-dashboard">
      <PracticePulseHeading />
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-6">
        {/* Cluster 1 — practice-level KPIs */}
        <MetricKpi
          label="Patients"
          icon={<Users className={KPI_ICON} style={KPI_ICON_STYLE} strokeWidth={1.75} />}
          testId="stat-patients"
          today={todayStat}
          last7={last7}
          last30={last30}
          windowKey="patients"
          value={last7?.patients ?? 0}
          accent={upcoming?.ancillaryPatients ?? 0}
          accentLabel={`${upcoming?.ancillaryPatients ?? 0} patients scheduled for ancillaries in the next 7 days`}
          accentTestId="stat-patients-upcoming"
        />
        <MetricKpi
          label="Calls"
          icon={<Phone className={KPI_ICON} style={KPI_ICON_STYLE} strokeWidth={1.75} />}
          testId="stat-calls-planned"
          today={todayStat}
          last7={last7}
          last30={last30}
          windowKey="callsPlanned"
          value={last7?.callsPlanned ?? 0}
          accent={callsDistributed}
          accentLabel={`${callsDistributed} anticipated calls in the next 7 days`}
          accentTestId="stat-calls-planned-upcoming"
          bodyOverride={
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px]">
                <span style={{ color: "var(--w-text-2)" }}>Planned today</span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--w-text)" }}>
                  {todayStat?.callsPlanned ?? 0}
                </span>
              </div>
              <div className="pt-3 border-t space-y-1.5" style={{ borderColor: "var(--w-divider)" }}>
                <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--w-text-muted)" }}>
                  Calls logged
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ color: "var(--w-text-2)" }}>Last 7 days</span>
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: "var(--w-text)" }}
                    data-testid="stat-calls-planned-last7"
                  >
                    {last7?.callsPlanned ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ color: "var(--w-text-2)" }}>Last 30 days</span>
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: "var(--w-text)" }}
                    data-testid="stat-calls-planned-last30"
                  >
                    {last30?.callsPlanned ?? 0}
                  </span>
                </div>
              </div>
              <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--w-divider)" }}>
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
        <MetricKpi
          label="Revenue"
          icon={<DollarSign className={KPI_ICON} style={KPI_ICON_STYLE} strokeWidth={1.75} />}
          testId="stat-finances"
          value={<span data-testid="stat-finances-collected">{formatDollars(financeLast7)}</span>}
          accent={formatDollars(financeUpcoming)}
          accentLabel={`${formatDollars(financeUpcoming)} anticipated revenue in the next 7 days`}
          accentTestId="stat-finances-upcoming"
          bodyOverride={
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span style={{ color: "var(--w-text-2)" }}>Collected · last 7 days</span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: "var(--w-text)" }}
                  data-testid="stat-finances-last7"
                >
                  {formatDollars(financeLast7)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span style={{ color: "var(--w-text-2)" }}>Anticipated · next 7 days</span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: "var(--w-green)" }}
                  data-testid="stat-finances-anticipated"
                >
                  {formatDollars(financeUpcoming)}
                </span>
              </div>
            </div>
          }
        />

        {/* Cluster divider (§12 — separators only between clusters) */}
        <div
          className="winter-divider mx-1 md:mx-2 h-14 w-px self-center"
          aria-hidden="true"
        />

        {/* Cluster 2 — ancillary systems */}
        <div className="flex items-start gap-1" data-testid="live-dashboard-system-ancillaries">
          <KpiGroup
            label="BrainWave"
            icon={<Brain className={KPI_ICON} style={KPI_ICON_STYLE} strokeWidth={1.75} />}
            value={<span data-testid="ancillary-brainwave">{breakdown?.brainWave ?? 0}</span>}
            accent={breakdown?.brainWaveUpcoming ?? 0}
            accentLabel={`${breakdown?.brainWaveUpcoming ?? 0} scheduled in the next 7 days`}
            accentTestId="ancillary-brainwave-upcoming"
          />
          <KpiGroup
            label="VitalWave"
            icon={<HeartPulse className={KPI_ICON} style={KPI_ICON_STYLE} strokeWidth={1.75} />}
            value={<span data-testid="ancillary-vitalwave">{breakdown?.vitalWave ?? 0}</span>}
            accent={breakdown?.vitalWaveUpcoming ?? 0}
            accentLabel={`${breakdown?.vitalWaveUpcoming ?? 0} scheduled in the next 7 days`}
            accentTestId="ancillary-vitalwave-upcoming"
          />
          <KpiGroup
            label="Ultrasound"
            icon={<Waves className={KPI_ICON} style={KPI_ICON_STYLE} strokeWidth={1.75} />}
            value={<span data-testid="ancillary-ultrasound">{breakdown?.ultrasound ?? 0}</span>}
            accent={breakdown?.ultrasoundUpcoming ?? 0}
            accentLabel={`${breakdown?.ultrasoundUpcoming ?? 0} scheduled in the next 7 days`}
            accentTestId="ancillary-ultrasound-upcoming"
          />
        </div>
      </div>
    </div>
  );
}
