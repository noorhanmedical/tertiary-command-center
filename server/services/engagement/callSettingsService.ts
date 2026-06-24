import { and, eq, lt, or, isNull, isNotNull, count, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases, ptoRequests } from "@shared/schema";

// ─── Pure target math ───────────────────────────────────────────────────────
//
// All Engagement Call Settings targets are DERIVED from the persisted
// inputs so the math is a single source of truth (never stored, never
// drifts). Rounding rule, matching the product spec's worked examples:
//   • completed-call KPI uses floor (25% of 30 = 7.5 → 7)
//   • scheduled KPI + visit target use round-half-up
//   • outreach target = completed KPI − visit target (so the split always
//     sums exactly to the completed-call KPI)

export interface CallSettingsInputs {
  callWorkdayPercent: number;
  visitPercent: number;
  baseCompletedCallKpi: number;
  scheduledKpiPercent: number;
  maxDailyCapacity?: number | null;
}

export interface CallTargets {
  completedCallKpi: number;
  scheduledKpi: number;
  visitTarget: number;
  outreachTarget: number;
  maxDailyCapacity: number;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function computeCallTargets(input: CallSettingsInputs): CallTargets {
  const workday = clampPercent(input.callWorkdayPercent);
  const visitPct = clampPercent(input.visitPercent);
  const scheduledPct = clampPercent(input.scheduledKpiPercent);
  const base = Math.max(0, Math.floor(input.baseCompletedCallKpi || 0));

  const completedCallKpi = Math.floor((base * workday) / 100);
  const scheduledKpi = Math.round((completedCallKpi * scheduledPct) / 100);
  const visitTarget = Math.round((completedCallKpi * visitPct) / 100);
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
