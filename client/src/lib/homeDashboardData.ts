// Home dashboard data normalizer.
//
// Keeps PlexusHomeDashboard presentational: this module maps the REAL
// backend contracts (/api/home-stats via useHomeStats, /api/schedule/dashboard
// via useScheduleDashboard, and /api/plexus/tasks/* via the plexus-tasks
// hooks) into the HomeDashboardData view-model.
//
// HONESTY RULE (per data-completion spec §3): a metric backed by a real,
// clinic-scoped source shows its number (including a real 0). A metric with
// no connected/verified source — either because the endpoint marks it
// `sourceMissing`, or because no aggregation exists yet — shows the EM_DASH
// sentinel ("—"), never a fake 0.

import type { HomeStatsResponse } from "@/hooks/api/home-stats";
import type { ScheduleDashboardResponse } from "@/components/HomeDashboard";
import type { HomeDashboardData, PulseMetric, ClinicRow, ScheduleItem, TaskItem } from "@/components/PlexusHomeDashboard";

export const EM_DASH = "—";

type OverdueTasks = { overdueCount: number; dueTodayCount: number } | undefined;

export type BuildHomeInputs = {
  userName: string;
  homeStats: HomeStatsResponse | undefined;
  scheduleDashboard: ScheduleDashboardResponse | undefined;
  overdueTasks: OverdueTasks;
};

function num(value: number | undefined, sourceMissing?: boolean): string | number {
  if (sourceMissing) return EM_DASH;
  return typeof value === "number" ? value : EM_DASH;
}

/** Metrics with no trustworthy source yet always render the dash. */
function unavailable(label: string, helper?: string): PulseMetric {
  return { label, value: EM_DASH, helper };
}

export function buildHomeDashboardData(inputs: BuildHomeInputs): HomeDashboardData {
  const { userName, homeStats, scheduleDashboard, overdueTasks } = inputs;
  const avail = homeStats?.availability;

  // ── Practice Pulse ──────────────────────────────────────────────────────
  // Patients: real "patients added, last 7 days" (clinic-scoped). This is the
  // correct available business count today; a true cross-batch unique-patient
  // census has no live source (identity tables are dormant), so we use the
  // real windowed count rather than a fabricated total.
  const patients: PulseMetric = {
    label: "Patients",
    value: num(homeStats?.windows.last7.patients),
    helper: "added · last 7 days",
  };

  // Calls: real outreach calls in the last-7 window; marked unavailable for
  // admins (no clinic scope) via the availability sidecar.
  const callsMissing = avail?.windows?.last7?.callsPlanned?.sourceMissing;
  const calls: PulseMetric = {
    label: "Calls",
    value: num(homeStats?.windows.last7.callsPlanned, callsMissing),
    helper: "last 7 days",
  };

  // Revenue (gross charges): no dedicated aggregation exists → unavailable.
  const revenue = unavailable("Revenue", "no source yet");

  // Collections: real payments posted in the last-7 window (finance.last7).
  const collectionsMissing = avail?.finance?.last7?.sourceMissing;
  const collections: PulseMetric = {
    label: "Collections",
    value: collectionsMissing || homeStats == null ? EM_DASH : `$${homeStats.finance.last7.toLocaleString()}`,
    helper: "collected · last 7 days",
  };

  // Outstanding A/R: real outstanding invoice balance (finance.upcoming).
  const arMissing = avail?.finance?.upcoming?.sourceMissing;
  const outstandingAR: PulseMetric = {
    label: "Outstanding A/R",
    value: arMissing || homeStats == null ? EM_DASH : `$${homeStats.finance.upcoming.toLocaleString()}`,
  };

  // BrainWave / VitalWave / Ultrasound: real SCHEDULED-today counts from
  // global_schedule_events (ancillaryBreakdown). These are scheduled, not
  // clinically-completed (completed-by-service has no aggregate endpoint yet).
  const brainWave: PulseMetric = { label: "BrainWave", value: num(homeStats?.ancillaryBreakdown.brainWave), helper: "scheduled today" };
  const vitalWave: PulseMetric = { label: "VitalWave", value: num(homeStats?.ancillaryBreakdown.vitalWave), helper: "scheduled today" };
  const ultrasound: PulseMetric = { label: "Ultrasound", value: num(homeStats?.ancillaryBreakdown.ultrasound), helper: "scheduled today" };

  // ── Network Overview ────────────────────────────────────────────────────
  // Real per-clinic patient/ancillary counts come from the schedule dashboard
  // clinic tabs (today column). Calls/Revenue per clinic and a clinic-health
  // Status rule have no trustworthy source → dash / omitted.
  const clinics: ClinicRow[] = (scheduleDashboard?.clinicTabs ?? []).map((tab, i) => {
    const todayIso = scheduleDashboard?.today;
    const todayCell = tab.weekDays?.find((d) => d.isoDate === todayIso);
    return {
      id: tab.clinicKey ?? i,
      name: tab.clinicLabel ?? "Unassigned",
      patients: todayCell?.patientCount ?? 0,
      studies: todayCell?.ancillaryCount ?? 0,
      calls: EM_DASH, // no per-clinic call source
      revenue: EM_DASH, // no per-clinic revenue source
      status: undefined, // no clinic-health rule exists → no fabricated status
    };
  });

  // ── Today's Summary ─────────────────────────────────────────────────────
  const todayNewPatients: PulseMetric = {
    label: "New Patients",
    value: num(homeStats?.windows.today.patients),
    helper: "today",
  };
  // Completed studies today has no aggregate source (procedure_events count
  // endpoint not authored) → unavailable, not the scheduled count.
  const todayCompletedStudies = unavailable("Completed Studies", "today");
  const todayRevenue = unavailable("Revenue", "today");

  // ── Tasks ────────────────────────────────────────────────────────────────
  // Only the real Plexus Tasks overdue/due-today queue is wired. Clinician
  // sign-offs / incomplete documents / intake queues have no general-purpose
  // Home source (flag-gated / role-scoped) → omitted rather than faked.
  const tasks: TaskItem[] = [];
  if (overdueTasks) {
    if (overdueTasks.overdueCount > 0) {
      tasks.push({ label: "Overdue tasks", count: overdueTasks.overdueCount, due: "Overdue", tone: "red" });
    }
    if (overdueTasks.dueTodayCount > 0) {
      tasks.push({ label: "Tasks due today", count: overdueTasks.dueTodayCount, due: "Due today", tone: "amber" });
    }
  }

  // ── Schedule Snapshot ─────────────────────────────────────────────────────
  // Real per-service scheduled-today counts from home-stats ancillaryBreakdown.
  const schedule: ScheduleItem[] = [];
  if (homeStats) {
    const b = homeStats.ancillaryBreakdown;
    if (b.brainWave > 0) schedule.push({ time: "Today", label: "BrainWave", count: b.brainWave, tone: "blue" });
    if (b.vitalWave > 0) schedule.push({ time: "Today", label: "VitalWave", count: b.vitalWave, tone: "green" });
    if (b.ultrasound > 0) schedule.push({ time: "Today", label: "Ultrasound", count: b.ultrasound, tone: "amber" });
  }

  return {
    userName,
    dateLabel: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    pulse: { patients, calls, revenue, collections, outstandingAR, brainWave, vitalWave, ultrasound },
    clinics,
    today: { newPatients: todayNewPatients, completedStudies: todayCompletedStudies, revenue: todayRevenue },
    tasks,
    schedule,
    clocks: buildClocks(),
  };
}

// ── Global clocks (live, no backend) — spec §12 ────────────────────────────
const CLOCK_ZONES: Array<{ city: string; zone: string; label: string }> = [
  { city: "Arizona", zone: "America/Phoenix", label: "MST" },
  { city: "Houston", zone: "America/Chicago", label: "CDT" },
  { city: "Michigan", zone: "America/Detroit", label: "EDT" },
  { city: "Dhaka", zone: "Asia/Dhaka", label: "BST" },
  { city: "Manila", zone: "Asia/Manila", label: "PST" },
];

export function buildClocks() {
  const now = new Date();
  return CLOCK_ZONES.map(({ city, zone, label }) => ({
    city,
    time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(now),
    timezone: label,
    date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: zone }).format(now),
  }));
}
