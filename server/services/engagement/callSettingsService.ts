import { and, eq, lt, or, isNull, isNotNull, count, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases, ptoRequests } from "@shared/schema";
import type { EngagementCallConfig, RoundingMode, WorkdayTier } from "@shared/schema";

// ─── Pure target math ───────────────────────────────────────────────────────
//
// All Engagement Call Settings targets are DERIVED from the persisted per-
// member inputs plus the global admin config so the math is a single source
// of truth (never stored, never drifts).
//
// Priority order (admin spec):
//   completed-call KPI : explicit per-member override
//                        → matching workday tier
//                        → floor(fullDayCompletedCallTarget × workday%)
//   scheduled KPI      : explicit per-member override
//                        → round/floor/ceil(completedKpi × scheduledPct%)
//   visit / outreach   : per-member split → global default; the rounding mode
//                        rounds the visit target and outreach = completedKpi −
//                        visit, so the two counts always sum to completedKpi.
//
// The completed-call KPI formula always floors so it never overstates daily
// capacity; the configurable rounding mode applies to the scheduled KPI and
// the visit-target split.

export interface CallSettingsInputs {
  callWorkdayPercent: number;
  visitPercent?: number | null;
  outreachPercent?: number | null;
  explicitCompletedCallKpi?: number | null;
  explicitScheduledKpi?: number | null;
  maxDailyCapacity?: number | null;
}

export interface CallTargets {
  completedCallKpi: number;
  scheduledKpi: number;
  visitTarget: number;
  outreachTarget: number;
  maxDailyCapacity: number;
  effectiveVisitPercent: number;
  effectiveOutreachPercent: number;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function applyRounding(mode: RoundingMode, n: number): number {
  if (mode === "floor") return Math.floor(n);
  if (mode === "ceil") return Math.ceil(n);
  return Math.round(n);
}

function findTierKpi(tiers: WorkdayTier[], workdayPercent: number): number | null {
  const match = tiers.find((t) => t.workdayPercent === workdayPercent);
  return match ? Math.max(0, Math.floor(match.completedCallKpi)) : null;
}

export function computeCallTargets(
  input: CallSettingsInputs,
  config: EngagementCallConfig,
): CallTargets {
  const workday = clampPercent(input.callWorkdayPercent);
  const round = (n: number) => applyRounding(config.roundingMode, n);

  // Completed-call KPI: explicit override → tier match → floor(formula).
  let completedCallKpi: number;
  if (input.explicitCompletedCallKpi != null && input.explicitCompletedCallKpi >= 0) {
    completedCallKpi = Math.floor(input.explicitCompletedCallKpi);
  } else {
    const tierKpi = findTierKpi(config.workdayTiers, workday);
    completedCallKpi =
      tierKpi != null
        ? tierKpi
        : Math.floor(
            (Math.max(0, config.fullDayCompletedCallTarget) * workday) / 100,
          );
  }

  // Scheduled KPI: explicit override → rounded(completedKpi × scheduledPct%).
  let scheduledKpi: number;
  if (input.explicitScheduledKpi != null && input.explicitScheduledKpi >= 0) {
    scheduledKpi = Math.floor(input.explicitScheduledKpi);
  } else {
    scheduledKpi = round(
      (completedCallKpi * clampPercent(config.scheduledPatientTargetPercent)) / 100,
    );
  }

  // Visit / outreach: per-member split → global default; counts sum to KPI.
  const effectiveVisitPercent = clampPercent(
    input.visitPercent ?? config.defaultVisitCallPercent,
  );
  const effectiveOutreachPercent = 100 - effectiveVisitPercent;
  const visitTarget = Math.min(
    completedCallKpi,
    Math.max(0, round((completedCallKpi * effectiveVisitPercent) / 100)),
  );
  const outreachTarget = Math.max(0, completedCallKpi - visitTarget);

  const maxDailyCapacity =
    input.maxDailyCapacity != null && input.maxDailyCapacity >= 0
      ? input.maxDailyCapacity
      : completedCallKpi;

  return {
    completedCallKpi,
    scheduledKpi,
    visitTarget,
    outreachTarget,
    maxDailyCapacity,
    effectiveVisitPercent,
    effectiveOutreachPercent,
  };
}

export function remainingCapacity(
  completedCallKpi: number,
  carryover: number,
): number {
  return Math.max(0, completedCallKpi - Math.max(0, carryover));
}

// ─── Carryover (active incomplete work from prior days) ──────────────────────
//
// Carryover = active execution cases assigned to a team member that still
// need a call/follow-up AND are due (or were created) before today. We
// exclude any case that no longer needs call action: completed, scheduled,
// cancelled, archived, closed. Counted per assigned team member.
const CARRYOVER_EXCLUDED_ENGAGEMENT_STATUSES = [
  "completed",
  "scheduled",
  "cancelled",
  "archived",
  "closed",
];

export function startOfTodayUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getCarryoverCounts(
  schedulerIds: number[],
  startOfToday: Date = startOfTodayUtc(),
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
        sql`${patientExecutionCases.engagementStatus} NOT IN (${sql.join(
          CARRYOVER_EXCLUDED_ENGAGEMENT_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        or(
          and(
            isNotNull(patientExecutionCases.nextActionAt),
            lt(patientExecutionCases.nextActionAt, startOfToday),
          ),
          and(
            isNull(patientExecutionCases.nextActionAt),
            lt(patientExecutionCases.createdAt, startOfToday),
          ),
        ),
      ),
    )
    .groupBy(patientExecutionCases.assignedTeamMemberId);

  for (const r of rows) {
    if (r.schedulerId != null) result.set(r.schedulerId, Number(r.n));
  }
  return result;
}

// ─── Platform-calendar working status (PTO + roster) ─────────────────────────
//
// There is no positive shift-calendar source yet (TeamOps treats coverage as
// full clinic hours), so we derive working-today honestly from the real
// platform signals we DO have: approved PTO (absence) and roster presence.
//   • Approved PTO covering today  → calendarWorkingToday = false (status "pto")
//   • Roster member with a user id → calendarWorkingToday = true  (status "working")
//   • No linked user id            → calendarWorkingToday = null  (status "unavailable")
// No Google Calendar anywhere. The admin manual override always wins.
export type CalendarStatus = "working" | "pto" | "unavailable";

export interface WorkingStatus {
  calendarWorkingToday: boolean | null;
  calendarStatus: CalendarStatus;
  ptoToday: boolean;
}

export async function getPtoUserIdsForToday(
  userIds: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<Set<string>> {
  const out = new Set<string>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: ptoRequests.userId })
    .from(ptoRequests)
    .where(
      and(
        inArray(ptoRequests.userId, userIds),
        eq(ptoRequests.status, "approved"),
        sql`${ptoRequests.startDate} <= ${today}`,
        sql`${ptoRequests.endDate} >= ${today}`,
      ),
    );
  for (const r of rows) {
    if (r.userId) out.add(r.userId);
  }
  return out;
}

export function deriveWorkingStatus(
  userId: string | null | undefined,
  ptoUserIds: Set<string>,
): WorkingStatus {
  const ptoToday = !!userId && ptoUserIds.has(userId);
  if (ptoToday) {
    return { calendarWorkingToday: false, calendarStatus: "pto", ptoToday: true };
  }
  if (userId) {
    return {
      calendarWorkingToday: true,
      calendarStatus: "working",
      ptoToday: false,
    };
  }
  return {
    calendarWorkingToday: null,
    calendarStatus: "unavailable",
    ptoToday: false,
  };
}

export function resolveWorkingToday(
  manualWorkingToday: boolean | null | undefined,
  calendarWorkingToday: boolean | null,
): boolean {
  if (manualWorkingToday != null) return manualWorkingToday;
  // No manual override: trust the calendar; default to working when the
  // calendar can't tell us (so distribution is never silently blocked).
  return calendarWorkingToday ?? true;
}
