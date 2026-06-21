import { Brain, HeartPulse, Phone, Users, Waves, CalendarRange, Activity, DollarSign } from "lucide-react";
import { useHomeStats } from "@/hooks/api/home-stats";

/** Compact USD for at-a-glance display: $1.2k, $940, $1.3M. */
function formatCompactCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

function StatCard({
  label,
  value,
  icon,
  testId,
  accent,
  subValue,
  subValueTestId,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  testId: string;
  accent?: string;
  subValue?: string;
  subValueTestId?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-slate-200/70 dark:border-border bg-white/80 dark:bg-card/60 backdrop-blur px-4 py-3 flex items-center gap-3"
      data-testid={testId}
    >
      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${accent ?? "bg-slate-100 dark:bg-muted/40"}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-muted-foreground leading-tight truncate">
          {label}
        </div>
        <div className="text-xl font-semibold text-slate-900 dark:text-foreground tabular-nums leading-tight">
          {value}
        </div>
        {subValue ? (
          <div
            className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300 tabular-nums leading-tight mt-0.5"
            data-testid={subValueTestId}
          >
            {subValue} est.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  icon,
  tone,
  subValue,
}: {
  label: string;
  value?: number;
  icon: React.ReactNode;
  tone: string;
  subValue?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      {icon}
      <span>{label}</span>
      {value !== undefined ? (
        <span className="font-semibold tabular-nums">{value}</span>
      ) : null}
      {subValue ? (
        <span className="font-semibold tabular-nums opacity-70 border-l border-current/20 pl-1.5 ml-0.5">
          {subValue}
        </span>
      ) : null}
    </span>
  );
}

export function HomeLiveDashboard() {
  const { data, isLoading } = useHomeStats();

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="live-dashboard-loading">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[60px] rounded-2xl bg-slate-100 dark:bg-muted/40 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-2xl bg-slate-100 dark:bg-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const totals = data?.totals;
  const clinics = data?.clinics ?? [];
  const estimatesAvailable = data?.estimatesAvailable ?? false;
  const valueAvailable = data?.valueAvailable;

  return (
    <div className="space-y-4" data-testid="live-dashboard">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-300" strokeWidth={2} />
        <h2 className="text-[14px] font-semibold text-slate-900 dark:text-foreground tracking-tight">
          Today at a Glance
        </h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Patients Today"
          value={totals?.totalPatients ?? 0}
          icon={<Users className="w-5 h-5 text-indigo-700 dark:text-indigo-300" strokeWidth={1.75} />}
          accent="bg-indigo-100 dark:bg-indigo-500/15"
          testId="stat-total-patients"
        />
        <StatCard
          label="Ancillaries Today"
          value={totals?.totalAncillaries ?? 0}
          icon={<Activity className="w-5 h-5 text-violet-700 dark:text-violet-300" strokeWidth={1.75} />}
          accent="bg-violet-100 dark:bg-violet-500/15"
          testId="stat-total-ancillaries"
          subValue={
            estimatesAvailable
              ? formatCompactCurrency(totals?.estimatedValue ?? 0)
              : undefined
          }
          subValueTestId="stat-total-ancillaries-value"
        />
        <StatCard
          label="Active Schedules"
          value={totals?.activeSchedules ?? 0}
          icon={<CalendarRange className="w-5 h-5 text-sky-700 dark:text-sky-300" strokeWidth={1.75} />}
          accent="bg-sky-100 dark:bg-sky-500/15"
          testId="stat-active-schedules"
        />
        <StatCard
          label="Calls Planned"
          value={data?.callsPlannedToday ?? 0}
          icon={<Phone className="w-5 h-5 text-amber-700 dark:text-amber-300" strokeWidth={1.75} />}
          accent="bg-amber-100 dark:bg-amber-500/15"
          testId="stat-calls-planned"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="live-dashboard-system-ancillaries">
        <MetricChip
          label="BrainWave"
          value={totals?.brainWaveCount ?? 0}
          icon={<Brain className="w-3.5 h-3.5" strokeWidth={2} />}
          tone="bg-purple-50 text-purple-700 ring-1 ring-purple-100 dark:bg-purple-500/15 dark:text-purple-200 dark:ring-purple-500/20"
          subValue={
            valueAvailable?.brainWave
              ? formatCompactCurrency(totals?.brainWaveValue ?? 0)
              : undefined
          }
        />
        <MetricChip
          label="VitalWave"
          value={totals?.vitalWaveCount ?? 0}
          icon={<HeartPulse className="w-3.5 h-3.5" strokeWidth={2} />}
          tone="bg-red-50 text-red-700 ring-1 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/20"
          subValue={
            valueAvailable?.vitalWave
              ? formatCompactCurrency(totals?.vitalWaveValue ?? 0)
              : undefined
          }
        />
        <MetricChip
          label="Ultrasound"
          value={totals?.ultrasoundCount ?? 0}
          icon={<Waves className="w-3.5 h-3.5" strokeWidth={2} />}
          tone="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/20"
          subValue={
            valueAvailable?.ultrasound
              ? formatCompactCurrency(totals?.ultrasoundValue ?? 0)
              : undefined
          }
        />
        {estimatesAvailable ? (
          <MetricChip
            label="Est. Value"
            icon={<DollarSign className="w-3.5 h-3.5" strokeWidth={2} />}
            tone="bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:ring-slate-500/20"
            subValue={formatCompactCurrency(totals?.estimatedValue ?? 0)}
          />
        ) : null}
      </div>

      {clinics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-border bg-slate-50/60 dark:bg-muted/20 py-8 text-center text-sm text-slate-400 dark:text-muted-foreground">
          No clinics scheduled for today.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="live-dashboard-clinics">
          {clinics.map((clinic) => (
            <div
              key={clinic.clinicKey}
              className="rounded-2xl border border-slate-200/70 dark:border-border bg-white/80 dark:bg-card/60 backdrop-blur px-4 py-3"
              data-testid={`clinic-stat-${clinic.clinicKey}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-foreground truncate">
                  {clinic.clinicLabel}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {estimatesAvailable ? (
                    <span
                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-300 tabular-nums"
                      data-testid={`clinic-value-${clinic.clinicKey}`}
                    >
                      <DollarSign className="w-3.5 h-3.5" strokeWidth={2} />
                      {formatCompactCurrency(clinic.estimatedValue)}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-muted-foreground">
                    <Users className="w-3.5 h-3.5" strokeWidth={2} />
                    <span className="tabular-nums">{clinic.patientCount}</span>
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <MetricChip
                  label="BW"
                  value={clinic.brainWaveCount}
                  icon={<Brain className="w-3.5 h-3.5" strokeWidth={2} />}
                  tone="bg-purple-50 text-purple-700 ring-1 ring-purple-100 dark:bg-purple-500/15 dark:text-purple-200 dark:ring-purple-500/20"
                />
                <MetricChip
                  label="VW"
                  value={clinic.vitalWaveCount}
                  icon={<HeartPulse className="w-3.5 h-3.5" strokeWidth={2} />}
                  tone="bg-red-50 text-red-700 ring-1 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/20"
                />
                <MetricChip
                  label="US"
                  value={clinic.ultrasoundCount}
                  icon={<Waves className="w-3.5 h-3.5" strokeWidth={2} />}
                  tone="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/20"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
