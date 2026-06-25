import { and, count, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { storage } from "../../storage";
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";
import {
  computeCallTargets,
  remainingCapacity,
  getCarryoverCounts,
  getPtoUserIdsForToday,
  deriveWorkingStatus,
  resolveWorkingToday,
  startOfTodayUtc,
  getGlobalCallConfig,
  type CalendarStatus,
} from "./callSettingsService";

// ─── Live Team Metrics (Phase 3) ────────────────────────────────────────────
//
// An admin-facing rollup of TODAY's engagement activity, derived ONLY from
// data we actually have:
//   • the call log (outreach_calls) for disposition counts, and
//   • the execution-case spine (patient_execution_cases) for active queue and
//     carryover.
// Targets/KPIs are NOT re-derived here — they reuse the exact call-settings
// target math (computeCallTargets + getGlobalCallConfig) so the numbers can
// never drift from the Call Settings surface.
//
// There is no RingCentral telemetry feed wired in. The read model is explicit
// about that boundary (ringCentralLiveConnected: false) instead of fabricating
// live dial/connect events.

// ─── Disposition mapping ─────────────────────────────────────────────────────
//
// Every logged call carries a free-text `outcome`. We bucket each outcome into
// exactly ONE disposition category so the per-category counts always sum to the
// total number of attempts (a property the verification script locks). The
// known OUTREACH_CALL_OUTCOMES + canonical CALL_RESULT_OUTCOMES all map to a
// real category; anything unrecognised falls into `other` so the sum still
// holds.

export const DISPOSITION_CATEGORIES = [
  "scheduled",
  "completed",
  "noAnswer",
  "voicemail",
  "declined",
  "followUp",
  "other",
] as const;

export type DispositionCategory = (typeof DISPOSITION_CATEGORIES)[number];

export type DispositionBreakdown = Record<DispositionCategory, number>;

const OUTCOME_TO_DISPOSITION: Record<string, DispositionCategory> = {
  // Positive terminal — patient is booked / served.
  scheduled: "scheduled",
  completed: "scheduled",
  // Live conversation that did not (yet) terminate positively.
  reached: "completed",
  // No live contact.
  no_answer: "noAnswer",
  busy: "noAnswer",
  hung_up: "noAnswer",
  disconnected: "noAnswer",
  mailbox_full: "noAnswer",
  voicemail: "voicemail",
  // Negative terminal.
  declined: "declined",
  not_interested: "declined",
  refused_dnc: "declined",
  dnc: "declined",
  do_not_contact: "declined",
  wrong_number: "declined",
  moved: "declined",
  deceased: "declined",
  cancelled: "declined",
  language_barrier: "declined",
  // Needs another touch / follow-up work.
  callback: "followUp",
  wants_more_info: "followUp",
  will_think_about_it: "followUp",
  needs_records: "followUp",
  insurance_prior_auth_issue: "followUp",
  manager_review: "followUp",
  facility_specific_issue: "followUp",
};

/** Pure: map a raw call outcome string to its disposition category. */
export function mapOutcomeToDisposition(outcome: string): DispositionCategory {
  return OUTCOME_TO_DISPOSITION[outcome] ?? "other";
}

/** Pure: an all-zero disposition breakdown. */
export function emptyDispositionBreakdown(): DispositionBreakdown {
  return {
    scheduled: 0,
    completed: 0,
    noAnswer: 0,
    voicemail: 0,
    declined: 0,
    followUp: 0,
    other: 0,
  };
}

/** Pure: tally a list of outcomes into a disposition breakdown + total. The
 *  per-category counts always sum to `total`. */
export function summarizeDispositions(
  outcomes: string[],
): { breakdown: DispositionBreakdown; total: number } {
  const breakdown = emptyDispositionBreakdown();
  for (const o of outcomes) {
    breakdown[mapOutcomeToDisposition(o)] += 1;
  }
  return { breakdown, total: outcomes.length };
}

/** Pure: remaining KPI = max(0, target − completed). Never negative. */
export function computeRemainingKpi(target: number, completed: number): number {
  return Math.max(0, target - completed);
}

// ─── Member + team rollup shapes ─────────────────────────────────────────────

export interface TeamMetricsMember {
  schedulerId: number;
  name: string;
  facility: string;
  userId: string | null;
  // Working status (same derivation as Call Settings).
  workingToday: boolean;
  calendarStatus: CalendarStatus;
  ptoToday: boolean;
  // Targets (reused call-settings math).
  completedCallKpi: number;
  scheduledKpi: number;
  // Today's actuals from the call log.
  completedCalls: number; // total attempts logged today
  dispositions: DispositionBreakdown;
  scheduledToday: number; // patients scheduled today (scheduled disposition)
  // Derived remaining-to-target.
  remainingCallKpi: number;
  remainingScheduledKpi: number;
  // Queue health.
  activeQueue: number; // active non-terminal cases assigned to this member
  carryover: number; // past-due active cases (call-settings carryover)
  remainingCapacity: number; // call-settings capacity = max(0, kpi − carryover)
}

export interface TeamMetricsTotals {
  members: number;
  workingMembers: number;
  completedCallKpi: number;
  scheduledKpi: number;
  completedCalls: number;
  scheduledToday: number;
  remainingCallKpi: number;
  remainingScheduledKpi: number;
  activeQueue: number;
  carryover: number;
  dispositions: DispositionBreakdown;
}

export interface TeamMetricsResponse {
  asOfDate: string;
  generatedAt: string;
  ringCentralLiveConnected: boolean;
  calendarAvailable: boolean;
  unattributedCalls: number;
  members: TeamMetricsMember[];
  totals: TeamMetricsTotals;
}

const SETTINGS_DEFAULTS = {
  callWorkdayPercent: 100,
  visitPercent: null as number | null,
  explicitCompletedKpi: null as number | null,
  explicitScheduledKpi: null as number | null,
  maxDailyCapacity: null as number | null,
  manualWorkingToday: null as boolean | null,
};

const ACTIVE_QUEUE_EXCLUDED_ENGAGEMENT_STATUSES = [
  "completed",
  "scheduled",
  "cancelled",
  "archived",
  "closed",
];

function endOfTodayUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Active (non-terminal) execution cases currently assigned to each member,
 *  keyed by outreach_schedulers.id. Mirrors the carryover query's exclusions
 *  but without the past-due window — this is the live queue size. */
async function getActiveQueueCounts(
  schedulerIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (schedulerIds.length === 0) return result;
  const rows = await db
    .select({
      schedulerId: patientExecutionCases.assignedTeamMemberId,
      n: count(),
    })
    .from(patientExecutionCases)
    .where(
      and(
        isNotNull(patientExecutionCases.assignedTeamMemberId),
        inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
        eq(patientExecutionCases.lifecycleStatus, "active"),
        notInArray(
          patientExecutionCases.engagementStatus,
          ACTIVE_QUEUE_EXCLUDED_ENGAGEMENT_STATUSES,
        ),
      ),
    )
    .groupBy(patientExecutionCases.assignedTeamMemberId);
  for (const r of rows) {
    if (r.schedulerId != null) result.set(r.schedulerId, Number(r.n));
  }
  return result;
}

/** Pure: fold the per-member rows into team totals. The verification script
 *  asserts team totals equal the sum of member rows, so this is the single
 *  source of that aggregation. */
export function aggregateTeamTotals(
  members: TeamMetricsMember[],
): TeamMetricsTotals {
  const dispositions = emptyDispositionBreakdown();
  const totals: TeamMetricsTotals = {
    members: members.length,
    workingMembers: 0,
    completedCallKpi: 0,
    scheduledKpi: 0,
    completedCalls: 0,
    scheduledToday: 0,
    remainingCallKpi: 0,
    remainingScheduledKpi: 0,
    activeQueue: 0,
    carryover: 0,
    dispositions,
  };
  for (const m of members) {
    if (m.workingToday) totals.workingMembers += 1;
    totals.completedCallKpi += m.completedCallKpi;
    totals.scheduledKpi += m.scheduledKpi;
    totals.completedCalls += m.completedCalls;
    totals.scheduledToday += m.scheduledToday;
    totals.remainingCallKpi += m.remainingCallKpi;
    totals.remainingScheduledKpi += m.remainingScheduledKpi;
    totals.activeQueue += m.activeQueue;
    totals.carryover += m.carryover;
    for (const cat of DISPOSITION_CATEGORIES) {
      dispositions[cat] += m.dispositions[cat];
    }
  }
  return totals;
}

/** Build the live team-metrics read model for the admin dashboard. */
export async function getTeamMetrics(
  now: Date = new Date(),
): Promise<TeamMetricsResponse> {
  const { config, tiers } = await getGlobalCallConfig();
  const schedulers = await storage.getOutreachSchedulers();
  const schedulerIds = schedulers.map((s) => s.id);

  const settingsRows =
    await engagementCallSettingsRepository.listForSchedulers(schedulerIds);
  const settingsByScheduler = new Map(
    settingsRows.map((r) => [r.schedulerId, r]),
  );

  const startOfToday = startOfTodayUtc(now);
  const endOfToday = endOfTodayUtc(now);

  const [carryoverBySched, activeQueueBySched, calls] = await Promise.all([
    getCarryoverCounts(schedulerIds, startOfToday),
    getActiveQueueCounts(schedulerIds),
    storage.listOutreachCallsInRange(startOfToday, endOfToday),
  ]);

  const userIds = schedulers
    .map((s) => s.userId)
    .filter((id): id is string => !!id);
  const ptoUserIds = await getPtoUserIdsForToday(userIds);
  const calendarAvailable = userIds.length > 0;

  // Group today's calls by the user who logged them.
  const outcomesByUser = new Map<string, string[]>();
  let unattributedCalls = 0;
  for (const c of calls) {
    if (!c.schedulerUserId) {
      unattributedCalls += 1;
      continue;
    }
    const list = outcomesByUser.get(c.schedulerUserId) ?? [];
    list.push(c.outcome);
    outcomesByUser.set(c.schedulerUserId, list);
  }
  // Track which users mapped to a roster member so the remainder is honest.
  const attributedUserIds = new Set<string>();

  const members: TeamMetricsMember[] = schedulers.map((s) => {
    const saved = settingsByScheduler.get(s.id);
    const merged = {
      callWorkdayPercent:
        saved?.callWorkdayPercent ?? SETTINGS_DEFAULTS.callWorkdayPercent,
      visitPercent: saved?.visitPercent ?? SETTINGS_DEFAULTS.visitPercent,
      explicitCompletedKpi:
        saved?.explicitCompletedKpi ?? SETTINGS_DEFAULTS.explicitCompletedKpi,
      explicitScheduledKpi:
        saved?.explicitScheduledKpi ?? SETTINGS_DEFAULTS.explicitScheduledKpi,
      maxDailyCapacity:
        saved?.maxDailyCapacity ?? SETTINGS_DEFAULTS.maxDailyCapacity,
      manualWorkingToday:
        saved?.manualWorkingToday ?? SETTINGS_DEFAULTS.manualWorkingToday,
    };

    const targets = computeCallTargets(
      {
        callWorkdayPercent: merged.callWorkdayPercent,
        visitPercent: merged.visitPercent,
        explicitCompletedKpi: merged.explicitCompletedKpi,
        explicitScheduledKpi: merged.explicitScheduledKpi,
        maxDailyCapacity: merged.maxDailyCapacity,
      },
      config,
      tiers,
    );

    const memberOutcomes = s.userId
      ? outcomesByUser.get(s.userId) ?? []
      : [];
    if (s.userId && outcomesByUser.has(s.userId)) {
      attributedUserIds.add(s.userId);
    }
    const { breakdown, total } = summarizeDispositions(memberOutcomes);
    const scheduledToday = breakdown.scheduled;

    const carryover = carryoverBySched.get(s.id) ?? 0;
    const working = deriveWorkingStatus(s.userId, ptoUserIds);
    const workingToday = resolveWorkingToday(
      merged.manualWorkingToday,
      working.calendarWorkingToday,
    );

    return {
      schedulerId: s.id,
      name: s.name,
      facility: s.facility,
      userId: s.userId ?? null,
      workingToday,
      calendarStatus: working.calendarStatus,
      ptoToday: working.ptoToday,
      completedCallKpi: targets.completedCallKpi,
      scheduledKpi: targets.scheduledKpi,
      completedCalls: total,
      dispositions: breakdown,
      scheduledToday,
      remainingCallKpi: computeRemainingKpi(targets.completedCallKpi, total),
      remainingScheduledKpi: computeRemainingKpi(
        targets.scheduledKpi,
        scheduledToday,
      ),
      activeQueue: activeQueueBySched.get(s.id) ?? 0,
      carryover,
      remainingCapacity: remainingCapacity(targets.completedCallKpi, carryover),
    };
  });

  // Calls logged by a user account that isn't linked to any roster member are
  // counted as unattributed too (honest — they can't be credited to a target).
  for (const [userId, list] of outcomesByUser) {
    if (!attributedUserIds.has(userId)) unattributedCalls += list.length;
  }

  const totals = aggregateTeamTotals(members);

  return {
    asOfDate: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    ringCentralLiveConnected: false,
    calendarAvailable,
    unattributedCalls,
    members,
    totals,
  };
}
