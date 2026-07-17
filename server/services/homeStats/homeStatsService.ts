// Home stats service — powers /api/home-stats consumed by
// HomeLiveDashboard.
//
// Route contract: `requireAuth` (any authenticated user). Because ANY
// authenticated user can hit this endpoint, every metric MUST be
// clinic-scoped or return `sourceMissing: true`. Never leak
// platform-wide finance or outreach data through this endpoint.
//
// Scope resolution: `req.clinicId` (populated by clinicContext
// middleware). Admin sees `req.clinicId=null` and receives an honest
// "unavailable" for non-scopable metrics — they should use Mission
// Control's admin-only shape for platform-wide data.
//
// TIMEZONE POLICY
//   All windows are UTC. This platform has no clinic-timezone table
//   today. The service holds the ONLY policy; repos never call
//   `new Date()`.

import * as defaultRepo from "../../repositories/homeStats.repo";
import type {
  ClinicScope,
  DateWindow,
  MetricValue,
} from "../../repositories/homeStats.repo";

// Enumerated set of repository helpers the service depends on. The
// service accepts a `repo` argument that defaults to this shape;
// tests supply a fake without needing to overwrite the ESM module.
export type HomeStatsRepoDeps = Pick<
  typeof defaultRepo,
  | "countPatientsAddedInRange"
  | "countActiveSchedulesInRange"
  | "countOutreachCallsInRange"
  | "countAncillaryByCategoryInRange"
  | "sumPaymentsPostedInRange"
  | "sumInvoicesOutstanding"
  | "countDistinctPatientsScheduledInRange"
>;

export type HomeWindowStat = {
  patients: number;
  ancillaries: number;
  activeSchedules: number;
  callsPlanned: number;
};

export type HomeMemberCallStat = { name: string; count: number };

export type HomeUpcomingStat = {
  ancillaryPatients: number;
  activeSchedules: number;
  callsDistributed: number;
  callsDone: number;
};

export type HomeFinanceStat = { last7: number; upcoming: number };

// Per-metric availability sidecar. Additive to the client contract —
// unset fields mean "no availability information" so pre-Phase-3
// clients still parse the response.
export type HomeStatsAvailability = {
  finance?: {
    last7?: { sourceMissing: boolean; reason?: string };
    upcoming?: { sourceMissing: boolean; reason?: string };
  };
  windows?: {
    today?: { callsPlanned?: { sourceMissing: boolean; reason?: string } };
    last7?: { callsPlanned?: { sourceMissing: boolean; reason?: string } };
    last30?: { callsPlanned?: { sourceMissing: boolean; reason?: string } };
  };
  upcoming?: {
    ancillaryPatients?: { sourceMissing: boolean; reason?: string };
    callsDistributed?: { sourceMissing: boolean; reason?: string };
    callsDone?: { sourceMissing: boolean; reason?: string };
  };
  callsByMember?: { sourceMissing: boolean; reason?: string };
};

export type HomeStatsResponse = {
  today: string;
  finance: HomeFinanceStat;
  windows: {
    today: HomeWindowStat;
    last7: HomeWindowStat;
    last30: HomeWindowStat;
  };
  upcoming: HomeUpcomingStat;
  ancillaryBreakdown: {
    brainWave: number;
    vitalWave: number;
    ultrasound: number;
    brainWaveUpcoming: number;
    vitalWaveUpcoming: number;
    ultrasoundUpcoming: number;
  };
  callsByMember: {
    last7: HomeMemberCallStat[];
    last30: HomeMemberCallStat[];
  };
  availability?: HomeStatsAvailability;
};

function utcDayStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function utcAddDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function valueOr(m: MetricValue<number>, fallback = 0): number {
  return m.available ? m.value : fallback;
}

async function buildWindow(
  repo: HomeStatsRepoDeps,
  win: DateWindow,
  scope: ClinicScope,
): Promise<{ stat: HomeWindowStat; callsMeta: MetricValue<number> }> {
  const [patients, activeSchedules, calls, cats] = await Promise.all([
    repo.countPatientsAddedInRange(win, scope),
    repo.countActiveSchedulesInRange(win, scope),
    repo.countOutreachCallsInRange(win, scope),
    repo.countAncillaryByCategoryInRange(win, scope),
  ]);
  const ancillaries = cats.available
    ? cats.value.brainWave + cats.value.vitalWave + cats.value.ultrasound
    : 0;
  return {
    stat: {
      patients: valueOr(patients),
      ancillaries,
      activeSchedules: valueOr(activeSchedules),
      callsPlanned: valueOr(calls),
    },
    callsMeta: calls,
  };
}

// buildHomeStats accepts a controlled clock + explicit clinic scope.
// The route resolves both from the request (session role + clinicId).
export async function buildHomeStats(
  scope: ClinicScope,
  opts: { now?: Date; repo?: HomeStatsRepoDeps } = {},
): Promise<HomeStatsResponse> {
  const now = opts.now ?? new Date();
  const repo = opts.repo ?? (defaultRepo as HomeStatsRepoDeps);
  const todayStart = utcDayStart(now);
  const todayIso = todayStart.toISOString().slice(0, 10);
  const tomorrow = utcAddDays(todayStart, 1);
  const last7Start = utcAddDays(todayStart, -6);
  const last30Start = utcAddDays(todayStart, -29);
  const upcoming14End = utcAddDays(todayStart, 14);

  const [
    todayW,
    last7W,
    last30W,
    upcomingCategoryCounts,
    upcomingSchedules,
    upcomingDistinctPatients,
    financeLast7,
    financeOutstanding,
    todayCats,
  ] = await Promise.all([
    buildWindow(repo, { start: todayStart, end: tomorrow }, scope),
    buildWindow(repo, { start: last7Start, end: tomorrow }, scope),
    buildWindow(repo, { start: last30Start, end: tomorrow }, scope),
    repo.countAncillaryByCategoryInRange(
      { start: todayStart, end: upcoming14End },
      scope,
    ),
    repo.countActiveSchedulesInRange(
      { start: todayStart, end: upcoming14End },
      scope,
    ),
    // Upcoming ancillary patients — distinct patients with an
    // ancillary appointment inside the 14-day upcoming window,
    // cancelled events excluded, clinic-scoped.
    repo.countDistinctPatientsScheduledInRange(
      { start: todayStart, end: upcoming14End },
      scope,
      ["ancillary_appointment"],
    ),
    // Replaces the invoice.created_at proxy.
    repo.sumPaymentsPostedInRange(
      { start: last7Start, end: tomorrow },
      scope,
    ),
    repo.sumInvoicesOutstanding(scope),
    repo.countAncillaryByCategoryInRange(
      { start: todayStart, end: tomorrow },
      scope,
    ),
  ]);

  // Per-member call attribution requires a JOIN into outreach_schedulers +
  // clinic scoping — kept empty until authored. The UI treats an empty
  // list as "no attribution available for this window."
  const callsByMember = { last7: [] as HomeMemberCallStat[], last30: [] as HomeMemberCallStat[] };

  const brainWaveToday = todayCats.available ? todayCats.value.brainWave : 0;
  const vitalWaveToday = todayCats.available ? todayCats.value.vitalWave : 0;
  const ultrasoundToday = todayCats.available ? todayCats.value.ultrasound : 0;
  const brainWaveUp = upcomingCategoryCounts.available
    ? upcomingCategoryCounts.value.brainWave
    : 0;
  const vitalWaveUp = upcomingCategoryCounts.available
    ? upcomingCategoryCounts.value.vitalWave
    : 0;
  const ultrasoundUp = upcomingCategoryCounts.available
    ? upcomingCategoryCounts.value.ultrasound
    : 0;

  const availability: HomeStatsAvailability = {
    finance: {
      last7: financeLast7.available
        ? { sourceMissing: false }
        : { sourceMissing: true, reason: financeLast7.reason },
      upcoming: financeOutstanding.available
        ? { sourceMissing: false }
        : { sourceMissing: true, reason: financeOutstanding.reason },
    },
    windows: {
      today: {
        callsPlanned: todayW.callsMeta.available
          ? { sourceMissing: false }
          : { sourceMissing: true, reason: todayW.callsMeta.reason },
      },
      last7: {
        callsPlanned: last7W.callsMeta.available
          ? { sourceMissing: false }
          : { sourceMissing: true, reason: last7W.callsMeta.reason },
      },
      last30: {
        callsPlanned: last30W.callsMeta.available
          ? { sourceMissing: false }
          : { sourceMissing: true, reason: last30W.callsMeta.reason },
      },
    },
    upcoming: {
      ancillaryPatients: upcomingDistinctPatients.available
        ? { sourceMissing: false }
        : { sourceMissing: true, reason: upcomingDistinctPatients.reason },
      // callsDistributed / callsDone require a JOIN with
      // scheduler_assignments — kept unavailable until authored.
      callsDistributed: {
        sourceMissing: true,
        reason:
          "callsDistributed requires scheduler_assignments JOIN not yet authored.",
      },
      callsDone: {
        sourceMissing: true,
        reason:
          "callsDone requires outreach_calls outcome bucket not yet authored.",
      },
    },
    callsByMember: {
      sourceMissing: true,
      reason:
        "Per-member attribution requires outreach_schedulers JOIN not yet authored.",
    },
  };

  return {
    today: todayIso,
    finance: {
      last7: valueOr(financeLast7),
      upcoming: valueOr(financeOutstanding),
    },
    windows: { today: todayW.stat, last7: last7W.stat, last30: last30W.stat },
    upcoming: {
      ancillaryPatients: valueOr(upcomingDistinctPatients),
      activeSchedules: valueOr(upcomingSchedules),
      callsDistributed: 0,
      callsDone: 0,
    },
    ancillaryBreakdown: {
      brainWave: brainWaveToday,
      vitalWave: vitalWaveToday,
      ultrasound: ultrasoundToday,
      brainWaveUpcoming: brainWaveUp,
      vitalWaveUpcoming: vitalWaveUp,
      ultrasoundUpcoming: ultrasoundUp,
    },
    callsByMember,
    availability,
  };
}
