// Engagement Distribution Engine (Phase 2).
//
// Proposes and applies bulk assignments of waiting (unassigned) engagement
// cases across working team members, respecting:
//   • each member's REMAINING capacity (completed-call KPI − carryover),
//   • the per-member visit/outreach split,
//   • facility coverage (members with no facilities set cover any facility),
//   • working-today status (calendar/PTO or manual override) and active flag.
//
// The allocator (`buildDistributionPlan`) is a PURE, deterministic function so
// it can be unit-asserted in isolation (see script/checkDistribution.ts). All
// capacity/target math is REUSED from callSettingsService (computeCallTargets,
// getCarryoverCounts, remainingCapacity, working-status derivation) so this
// engine never re-derives the numbers differently from the Call Settings
// surface.

import { and, desc, eq, inArray, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import {
  patientExecutionCases,
  patientJourneyEvents,
  patientScreenings,
  screeningBatches,
  users,
  type NeedsCoverageCategory,
} from "@shared/schema";
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";
import { callHandoffsRepository } from "../../repositories/callHandoffs.repo";
import { needsCoverageRepository } from "../../repositories/needsCoverage.repo";
import { appendJourneyEvent, type AppendJourneyEventInput } from "../journey/appendJourneyEvent";
import { calculateNextActionAt } from "../callList/nextActionPolicy";
import {
  computeCallTargets,
  remainingCapacity,
  computeMemberCapacityState,
  getCarryoverCounts,
  getPtoUserIdsForToday,
  deriveWorkingStatus,
  resolveWorkingToday,
  startOfTodayUtc,
  getGlobalCallConfig,
} from "./callSettingsService";

// Any drizzle executor (the base `db` or a transaction handle).
type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | TxClient;

// ─── Pure allocator types ───────────────────────────────────────────────────

export type DistributionLane = "visit" | "outreach";

export interface DistributionMemberInput {
  schedulerId: number;
  name: string;
  facility: string | null;
  active: boolean;
  workingToday: boolean;
  // Empty/null => member covers ANY facility.
  facilitiesCovered: string[] | null;
  // Hard ceiling on NEW work today = max(0, completedCallKpi − carryover).
  remainingCapacity: number;
  // Per-lane sub-caps; visitTarget + outreachTarget == completedCallKpi.
  visitTarget: number;
  outreachTarget: number;
  // ─ Canonical capacity-state display fields (K2/K3, Phase 3B) ─
  // Carried through to memberSummaries so the manager preview shows the SAME
  // numbers as the workload display. The pure allocator ignores these for
  // planning (it only reads remainingCapacity + lane targets).
  configuredWorkloadPercent: number;
  dailyCallCapacity: number; // completed-call KPI capped by maxDailyCapacity
  assigned: number; // current standard workload (live owned queue)
  carryover: number; // past-due carryover
  priorityHandoffs: number; // outstanding P1/P2 handoffs (Phase 3C populates)
}

export interface DistributionCaseInput {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  facility: string | null;
  scheduleDate: string | null;
  engagementBucket: string | null;
}

export interface ProposedAssignment {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  facility: string | null;
  scheduleDate: string | null;
  lane: DistributionLane;
  schedulerId: number;
  schedulerName: string;
}

export interface UnplacedCase {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  facility: string | null;
  lane: DistributionLane;
  reason: string;
  // Structured NEEDS COVERAGE category (K8) so the manager view can group /
  // filter, not just read a free-text string.
  category: NeedsCoverageCategory;
}

export interface MemberAllocationSummary {
  schedulerId: number;
  name: string;
  facility: string | null;
  remainingCapacity: number;
  visitTarget: number;
  outreachTarget: number;
  assignedTotal: number; // NEW cases this plan proposes for the member
  assignedVisit: number;
  assignedOutreach: number;
  workingToday: boolean;
  active: boolean;
  // ─ Canonical capacity state (K2/K3) — pre-plan standing + projections ─
  configuredWorkloadPercent: number;
  dailyCallCapacity: number;
  carryover: number;
  priorityHandoffs: number;
  standardWorkload: number; // current owned queue BEFORE this plan (member.assigned)
  projectedEffectiveWorkload: number; // standardWorkload + priorityHandoffs + assignedTotal
  overCapacity: number; // max(0, projectedEffectiveWorkload − dailyCallCapacity)
}

export interface DistributionPlan {
  assignments: ProposedAssignment[];
  unplaced: UnplacedCase[];
  memberSummaries: MemberAllocationSummary[];
  totals: {
    poolSize: number;
    assigned: number;
    unplaced: number;
    eligibleMembers: number;
  };
}

// Visit cases consume the visit lane; everything else (outreach +
// scheduling_triage) consumes the outreach lane. This keeps the split to two
// lanes whose allocations always sum to the member total.
export function laneForBucket(bucket: string | null | undefined): DistributionLane {
  return (bucket ?? "").toLowerCase() === "visit" ? "visit" : "outreach";
}

function coversFacility(
  member: DistributionMemberInput,
  facility: string | null,
): boolean {
  const covered = (member.facilitiesCovered ?? [])
    .map((f) => f.trim())
    .filter(Boolean);
  if (covered.length === 0) return true; // no restriction → any facility
  const fac = (facility ?? "").trim();
  if (!fac) return false; // restricted member, case has no facility → cannot confirm
  return covered.includes(fac);
}

interface MemberState extends DistributionMemberInput {
  assignedTotal: number;
  assignedVisit: number;
  assignedOutreach: number;
}

function laneTarget(m: MemberState, lane: DistributionLane): number {
  return lane === "visit" ? m.visitTarget : m.outreachTarget;
}
function laneAssigned(m: MemberState, lane: DistributionLane): number {
  return lane === "visit" ? m.assignedVisit : m.assignedOutreach;
}

// Deterministic case ordering: soonest scheduleDate first (nulls last), then
// execution-case id ascending so the plan is stable across runs.
function sortCases(cases: DistributionCaseInput[]): DistributionCaseInput[] {
  return [...cases].sort((a, b) => {
    const ad = a.scheduleDate ?? "";
    const bd = b.scheduleDate ?? "";
    if (ad !== bd) {
      if (!ad) return 1;
      if (!bd) return -1;
      return ad.localeCompare(bd);
    }
    return a.executionCaseId - b.executionCaseId;
  });
}

/**
 * Pure, deterministic capacity-aware allocator.
 *
 * Greedy least-loaded assignment: each case goes to the eligible member with
 * the most remaining total headroom (tiebreak: more lane headroom, then lowest
 * schedulerId), which spreads the pool evenly. Invariants guaranteed:
 *   • assignedTotal ≤ remainingCapacity for every member,
 *   • assignedVisit ≤ visitTarget and assignedOutreach ≤ outreachTarget,
 *   • assignedVisit + assignedOutreach == assignedTotal,
 *   • a member only receives cases at facilities it covers,
 *   • only active + working-today members receive work.
 */
export function buildDistributionPlan(
  cases: DistributionCaseInput[],
  members: DistributionMemberInput[],
): DistributionPlan {
  const state: MemberState[] = members.map((m) => ({
    ...m,
    assignedTotal: 0,
    assignedVisit: 0,
    assignedOutreach: 0,
  }));
  const workingPool = state.filter((m) => m.active && m.workingToday);

  const assignments: ProposedAssignment[] = [];
  const unplaced: UnplacedCase[] = [];

  for (const c of sortCases(cases)) {
    const lane = laneForBucket(c.engagementBucket);

    const eligible = workingPool.filter(
      (m) =>
        coversFacility(m, c.facility) &&
        laneAssigned(m, lane) < laneTarget(m, lane) &&
        m.assignedTotal < m.remainingCapacity,
    );

    if (eligible.length === 0) {
      const { category, reason } = explainUnplaced(workingPool, c, lane);
      unplaced.push({
        executionCaseId: c.executionCaseId,
        patientScreeningId: c.patientScreeningId,
        patientName: c.patientName,
        facility: c.facility,
        lane,
        reason,
        category,
      });
      continue;
    }

    eligible.sort((a, b) => {
      const aHead = a.remainingCapacity - a.assignedTotal;
      const bHead = b.remainingCapacity - b.assignedTotal;
      if (aHead !== bHead) return bHead - aHead;
      const aLane = laneTarget(a, lane) - laneAssigned(a, lane);
      const bLane = laneTarget(b, lane) - laneAssigned(b, lane);
      if (aLane !== bLane) return bLane - aLane;
      return a.schedulerId - b.schedulerId;
    });

    const chosen = eligible[0];
    chosen.assignedTotal += 1;
    if (lane === "visit") chosen.assignedVisit += 1;
    else chosen.assignedOutreach += 1;

    assignments.push({
      executionCaseId: c.executionCaseId,
      patientScreeningId: c.patientScreeningId,
      patientName: c.patientName,
      patientDob: c.patientDob,
      facility: c.facility,
      scheduleDate: c.scheduleDate,
      lane,
      schedulerId: chosen.schedulerId,
      schedulerName: chosen.name,
    });
  }

  const memberSummaries: MemberAllocationSummary[] = state.map((m) => {
    const standardWorkload = Math.max(0, m.assigned);
    const priorityHandoffs = Math.max(0, m.priorityHandoffs);
    const projectedEffectiveWorkload =
      standardWorkload + priorityHandoffs + m.assignedTotal;
    const overCapacity = Math.max(
      0,
      projectedEffectiveWorkload - m.dailyCallCapacity,
    );
    return {
      schedulerId: m.schedulerId,
      name: m.name,
      facility: m.facility,
      remainingCapacity: m.remainingCapacity,
      visitTarget: m.visitTarget,
      outreachTarget: m.outreachTarget,
      assignedTotal: m.assignedTotal,
      assignedVisit: m.assignedVisit,
      assignedOutreach: m.assignedOutreach,
      workingToday: m.workingToday,
      active: m.active,
      configuredWorkloadPercent: m.configuredWorkloadPercent,
      dailyCallCapacity: m.dailyCallCapacity,
      carryover: m.carryover,
      priorityHandoffs,
      standardWorkload,
      projectedEffectiveWorkload,
      overCapacity,
    };
  });

  return {
    assignments,
    unplaced,
    memberSummaries,
    totals: {
      poolSize: cases.length,
      assigned: assignments.length,
      unplaced: unplaced.length,
      eligibleMembers: workingPool.length,
    },
  };
}

// Structured + human-readable reason a case could not be placed, narrowing
// from broad to specific so the manager view can group by category (K8) and
// show a clear, actionable warning.
function explainUnplaced(
  workingPool: MemberState[],
  c: DistributionCaseInput,
  lane: DistributionLane,
): { category: NeedsCoverageCategory; reason: string } {
  if (workingPool.length === 0) {
    return { category: "no_eligible_staff", reason: "No team members are working today." };
  }
  const facilityMembers = workingPool.filter((m) => coversFacility(m, c.facility));
  if (facilityMembers.length === 0) {
    return {
      category: "facility_coverage_mismatch",
      reason: `No working team member covers ${c.facility ? `facility "${c.facility}"` : "this patient's (missing) facility"}.`,
    };
  }
  const laneMembers = facilityMembers.filter(
    (m) => laneAssigned(m, lane) < laneTarget(m, lane),
  );
  if (laneMembers.length === 0) {
    return {
      category: "capacity_exhausted",
      reason: `All covering members have reached their ${lane} target.`,
    };
  }
  return {
    category: "capacity_exhausted",
    reason: "All covering members are at their remaining capacity.",
  };
}

// ─── DB gather: build the live pool + roster capacity ───────────────────────

/** Fetch every active, UNASSIGNED engagement case that still needs work,
 *  enriched with facility + scheduleDate from the screening/batch spine —
 *  mirroring the assignment-board read model. */
export async function gatherEligibleCases(
  exec: DbExecutor = db,
): Promise<DistributionCaseInput[]> {
  const cases = await exec
    .select()
    .from(patientExecutionCases)
    .where(
      and(
        isNull(patientExecutionCases.assignedTeamMemberId),
        or(
          isNull(patientExecutionCases.lifecycleStatus),
          eq(patientExecutionCases.lifecycleStatus, "active"),
        ),
        or(
          isNull(patientExecutionCases.engagementStatus),
          sql`${patientExecutionCases.engagementStatus} NOT IN ('archived','closed','cancelled','completed')`,
        ),
      ),
    );
  if (cases.length === 0) return [];

  const screeningIds = Array.from(
    new Set(
      cases
        .map((c) => c.patientScreeningId)
        .filter((id): id is number => id != null),
    ),
  );
  const screenings = screeningIds.length
    ? await exec
        .select()
        .from(patientScreenings)
        .where(
          and(
            inArray(patientScreenings.id, screeningIds),
            isNull(patientScreenings.deletedAt),
          ),
        )
    : [];
  const screeningById = new Map(screenings.map((s) => [s.id, s]));

  const batchIds = Array.from(
    new Set(
      screenings.map((s) => s.batchId).filter((id): id is number => id != null),
    ),
  );
  const batches = batchIds.length
    ? await exec
        .select()
        .from(screeningBatches)
        .where(inArray(screeningBatches.id, batchIds))
    : [];
  const batchById = new Map(batches.map((b) => [b.id, b]));

  return cases.map((c) => {
    const screening =
      c.patientScreeningId != null
        ? screeningById.get(c.patientScreeningId)
        : undefined;
    const batch =
      screening?.batchId != null ? batchById.get(screening.batchId) : undefined;
    const facility =
      screening?.facility ?? batch?.facility ?? c.facilityId ?? null;
    return {
      executionCaseId: c.id,
      patientScreeningId: c.patientScreeningId ?? null,
      patientName: c.patientName ?? screening?.name ?? "Unnamed",
      patientDob: c.patientDob ?? screening?.dob ?? null,
      facility,
      scheduleDate: batch?.scheduleDate ?? null,
      engagementBucket: c.engagementBucket ?? null,
    };
  });
}

/** Build the roster of distribution members with DERIVED targets, live
 *  carryover, remaining capacity, and working-today status — reusing the Call
 *  Settings math so the two surfaces never drift. */
export async function gatherDistributionMembers(): Promise<
  DistributionMemberInput[]
> {
  const { config, tiers } = await getGlobalCallConfig();
  const schedulers = await storage.getOutreachSchedulers();
  const schedulerIds = schedulers.map((s) => s.id);
  if (schedulerIds.length === 0) return [];

  const settingsRows =
    await engagementCallSettingsRepository.listForSchedulers(schedulerIds);
  const settingsByScheduler = new Map(
    settingsRows.map((r) => [r.schedulerId, r]),
  );

  const [carryoverBySched, activeQueueBySched, priorityHandoffByUser] =
    await Promise.all([
      getCarryoverCounts(schedulerIds, startOfTodayUtc()),
      getActiveQueueCounts(schedulerIds),
      callHandoffsRepository.countOpenPriorityByRecipient(),
    ]);

  const userIds = schedulers
    .map((s) => s.userId)
    .filter((id): id is string => !!id);
  const ptoUserIds = await getPtoUserIdsForToday(userIds);

  return schedulers.map((s) => {
    const saved = settingsByScheduler.get(s.id);
    const callWorkdayPercent = saved?.callWorkdayPercent ?? 100;
    const visitPercent = saved?.visitPercent ?? null;
    const explicitCompletedKpi = saved?.explicitCompletedKpi ?? null;
    const explicitScheduledKpi = saved?.explicitScheduledKpi ?? null;
    const maxDailyCapacity = saved?.maxDailyCapacity ?? null;
    const facilitiesCovered = saved?.facilitiesCovered ?? null;
    const manualWorkingToday = saved?.manualWorkingToday ?? null;
    const active = saved?.active ?? true;

    const targets = computeCallTargets(
      {
        callWorkdayPercent,
        visitPercent,
        explicitCompletedKpi,
        explicitScheduledKpi,
        maxDailyCapacity,
      },
      config,
      tiers,
    );
    const carryover = carryoverBySched.get(s.id) ?? 0;
    const assigned = activeQueueBySched.get(s.id) ?? 0;
    const priorityHandoffs = s.userId
      ? priorityHandoffByUser.get(s.userId) ?? 0
      : 0;
    const working = deriveWorkingStatus(s.userId, ptoUserIds);
    const workingToday = resolveWorkingToday(
      manualWorkingToday,
      working.calendarWorkingToday,
    );

    // Canonical capacity state — one source of truth shared with the workload
    // display (teamMetricsService uses the same computeMemberCapacityState).
    const capacity = computeMemberCapacityState({
      targets,
      configuredWorkloadPercent: callWorkdayPercent,
      assigned,
      carryover,
      priorityHandoffs, // open P1/P2 handoffs addressed to this member.
      workingToday,
    });

    return {
      schedulerId: s.id,
      name: s.name,
      facility: s.facility,
      active,
      workingToday,
      facilitiesCovered,
      remainingCapacity: capacity.remainingCapacity,
      visitTarget: targets.visitTarget,
      outreachTarget: targets.outreachTarget,
      configuredWorkloadPercent: capacity.configuredWorkloadPercent,
      dailyCallCapacity: capacity.dailyCallCapacity,
      assigned: capacity.assigned,
      carryover: capacity.carryover,
      priorityHandoffs: capacity.priorityHandoffs,
    };
  });
}

/** Active (non-terminal) execution cases currently owned by each member,
 *  keyed by outreach_schedulers.id — the member's live standard workload.
 *  Mirrors teamMetricsService.getActiveQueueCounts so distribution and the
 *  workload display measure "assigned" identically. */
async function getActiveQueueCounts(
  schedulerIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (schedulerIds.length === 0) return result;
  const rows = await db
    .select({
      schedulerId: patientExecutionCases.assignedTeamMemberId,
      n: sql<number>`count(*)::int`,
    })
    .from(patientExecutionCases)
    .where(
      and(
        isNotNull(patientExecutionCases.assignedTeamMemberId),
        inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
        eq(patientExecutionCases.lifecycleStatus, "active"),
        sql`${patientExecutionCases.engagementStatus} NOT IN ('completed','scheduled','cancelled','archived','closed')`,
      ),
    )
    .groupBy(patientExecutionCases.assignedTeamMemberId);
  for (const r of rows) {
    if (r.schedulerId != null) result.set(r.schedulerId, Number(r.n));
  }
  return result;
}

/** One-shot read-only preview: gather the live pool + roster and run the
 *  allocator. No writes. */
export async function previewDistribution(): Promise<{
  plan: DistributionPlan;
  members: DistributionMemberInput[];
  cases: DistributionCaseInput[];
}> {
  const [cases, members] = await Promise.all([
    gatherEligibleCases(),
    gatherDistributionMembers(),
  ]);
  const plan = buildDistributionPlan(cases, members);
  return { plan, members, cases };
}

// ─── Live progress + activity feed (Phase 3) ────────────────────────────────
//
// After a distribution is applied, admins need to watch real-time execution:
// how far each member is through their assigned work today, and a stream of the
// most recent assignment/outcome events across the team. Both are pure reads.

// Engagement statuses that mean the case has LEFT the active work queue today.
const COMPLETED_ENGAGEMENT_STATUSES = ["scheduled", "completed"] as const;

// Journey-event kinds that belong on the team activity feed (assignment moves
// and call/schedule outcomes). Pure-read filter — does not constrain writers.
export const ACTIVITY_EVENT_TYPES = [
  "engagement_assigned",
  "engagement_assignment_changed",
  "engagement_assignment_cancelled",
  "scheduler_assigned",
  "call_result_logged",
  "scheduled_ancillary",
  "schedule_cancelled",
  "schedule_rescheduled",
  "schedule_no_show",
  "schedule_confirmed",
] as const;

export interface MemberLiveProgress {
  schedulerId: number;
  name: string;
  facility: string | null;
  active: boolean;
  workingToday: boolean;
  // Cases this member moved to scheduled/completed today.
  completedToday: number;
  // Active, non-terminal cases still assigned to this member (work left).
  remaining: number;
  // Active cases already touched (contacted / not reached) but not finished.
  inProgress: number;
  // Today's completed-call KPI, reused from Call Settings math.
  completedKpi: number;
}

export interface ActivityFeedEvent {
  id: number;
  eventType: string;
  patientName: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
}

export interface LiveProgressResult {
  members: MemberLiveProgress[];
  activity: ActivityFeedEvent[];
  totals: {
    completedToday: number;
    remaining: number;
    inProgress: number;
    activeMembers: number;
  };
  asOf: string;
}

/** Read-only live execution snapshot: per-member completed/remaining counts for
 *  today plus the most recent team activity events. No writes. */
export async function getLiveProgress(
  activityLimit = 30,
): Promise<LiveProgressResult> {
  const startOfToday = startOfTodayUtc();

  const members = await gatherDistributionMembers();
  const schedulerIds = members.map((m) => m.schedulerId);

  const [completedRows, remainingRows, inProgressRows, activityRows] =
    await Promise.all([
      schedulerIds.length
        ? db
            .select({
              schedulerId: patientExecutionCases.assignedTeamMemberId,
              n: sql<number>`count(*)`,
            })
            .from(patientExecutionCases)
            .where(
              and(
                inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
                inArray(
                  patientExecutionCases.engagementStatus,
                  COMPLETED_ENGAGEMENT_STATUSES as unknown as string[],
                ),
                sql`${patientExecutionCases.updatedAt} >= ${startOfToday}`,
              ),
            )
            .groupBy(patientExecutionCases.assignedTeamMemberId)
        : Promise.resolve([] as { schedulerId: number | null; n: number }[]),
      schedulerIds.length
        ? db
            .select({
              schedulerId: patientExecutionCases.assignedTeamMemberId,
              n: sql<number>`count(*)`,
            })
            .from(patientExecutionCases)
            .where(
              and(
                inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
                eq(patientExecutionCases.lifecycleStatus, "active"),
                sql`${patientExecutionCases.engagementStatus} NOT IN ('scheduled','completed')`,
              ),
            )
            .groupBy(patientExecutionCases.assignedTeamMemberId)
        : Promise.resolve([] as { schedulerId: number | null; n: number }[]),
      schedulerIds.length
        ? db
            .select({
              schedulerId: patientExecutionCases.assignedTeamMemberId,
              n: sql<number>`count(*)`,
            })
            .from(patientExecutionCases)
            .where(
              and(
                inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
                eq(patientExecutionCases.lifecycleStatus, "active"),
                sql`${patientExecutionCases.engagementStatus} IN ('contacted','not_reached','unable_to_reach')`,
              ),
            )
            .groupBy(patientExecutionCases.assignedTeamMemberId)
        : Promise.resolve([] as { schedulerId: number | null; n: number }[]),
      db
        .select()
        .from(patientJourneyEvents)
        .where(
          inArray(
            patientJourneyEvents.eventType,
            ACTIVITY_EVENT_TYPES as unknown as string[],
          ),
        )
        .orderBy(desc(patientJourneyEvents.createdAt))
        .limit(activityLimit),
    ]);

  const completedById = new Map<number, number>();
  for (const r of completedRows)
    if (r.schedulerId != null) completedById.set(r.schedulerId, Number(r.n));
  const remainingById = new Map<number, number>();
  for (const r of remainingRows)
    if (r.schedulerId != null) remainingById.set(r.schedulerId, Number(r.n));
  const inProgressById = new Map<number, number>();
  for (const r of inProgressRows)
    if (r.schedulerId != null) inProgressById.set(r.schedulerId, Number(r.n));

  const memberProgress: MemberLiveProgress[] = members.map((m) => ({
    schedulerId: m.schedulerId,
    name: m.name,
    facility: m.facility,
    active: m.active,
    workingToday: m.workingToday,
    completedToday: completedById.get(m.schedulerId) ?? 0,
    remaining: remainingById.get(m.schedulerId) ?? 0,
    inProgress: inProgressById.get(m.schedulerId) ?? 0,
    completedKpi: m.visitTarget + m.outreachTarget,
  }));

  // Resolve actor display names (username) for the activity feed.
  const actorIds = Array.from(
    new Set(
      activityRows
        .map((e) => e.actorUserId)
        .filter((id): id is string => !!id),
    ),
  );
  const actorRows = actorIds.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const actorNameById = new Map(actorRows.map((u) => [u.id, u.username]));

  const activity: ActivityFeedEvent[] = activityRows.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    patientName: e.patientName,
    summary: e.summary,
    actorName: e.actorUserId ? actorNameById.get(e.actorUserId) ?? null : null,
    createdAt:
      e.createdAt instanceof Date
        ? e.createdAt.toISOString()
        : new Date(e.createdAt as unknown as string).toISOString(),
  }));

  const totals = memberProgress.reduce(
    (acc, m) => {
      acc.completedToday += m.completedToday;
      acc.remaining += m.remaining;
      acc.inProgress += m.inProgress;
      if (m.active && m.workingToday) acc.activeMembers += 1;
      return acc;
    },
    { completedToday: 0, remaining: 0, inProgress: 0, activeMembers: 0 },
  );

  return {
    members: memberProgress,
    activity,
    totals,
    asOf: new Date().toISOString(),
  };
}

// ─── Per-member case drill-down (Phase 3) ───────────────────────────────────
//
// Admins watching the Live Team Activity list want to click a member and see
// the actual named cases behind their remaining / in-progress / completed-today
// counts, so they can spot stuck work. Pure read — no writes.

// Active, touched-but-not-finished statuses (mirrors getLiveProgress).
const IN_PROGRESS_ENGAGEMENT_STATUSES = [
  "contacted",
  "not_reached",
  "unable_to_reach",
] as const;

export type MemberCaseCategory =
  | "remaining"
  | "in_progress"
  | "completed_today";

export interface MemberCaseItem {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  facility: string | null;
  engagementStatus: string | null;
  engagementBucket: string | null;
  category: MemberCaseCategory;
  lastAttemptAt: string | null;
  lastCallOutcome: string | null;
  callAttemptCount: number;
  nextActionAt: string | null;
  updatedAt: string | null;
}

export interface MemberCasesResult {
  schedulerId: number;
  name: string | null;
  counts: { remaining: number; inProgress: number; completedToday: number };
  cases: MemberCaseItem[];
  asOf: string;
}

function categorizeMemberCase(
  row: typeof patientExecutionCases.$inferSelect,
  startOfToday: Date,
): MemberCaseCategory | null {
  const status = row.engagementStatus ?? "";
  const updatedAt =
    row.updatedAt instanceof Date
      ? row.updatedAt
      : row.updatedAt
        ? new Date(row.updatedAt as unknown as string)
        : null;
  const completedToday =
    (COMPLETED_ENGAGEMENT_STATUSES as readonly string[]).includes(status) &&
    updatedAt != null &&
    updatedAt >= startOfToday;
  if (completedToday) return "completed_today";

  const isActive = (row.lifecycleStatus ?? "active") === "active";
  if (!isActive) return null;
  if ((COMPLETED_ENGAGEMENT_STATUSES as readonly string[]).includes(status)) {
    // Scheduled/completed but not updated today — not part of today's work.
    return null;
  }
  if ((IN_PROGRESS_ENGAGEMENT_STATUSES as readonly string[]).includes(status)) {
    return "in_progress";
  }
  return "remaining";
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Read-only list of a single member's active + completed-today cases, each
 *  tagged remaining / in_progress / completed_today, enriched with facility
 *  from the screening/batch spine. No writes. */
export async function getMemberCases(
  schedulerId: number,
): Promise<MemberCasesResult> {
  const startOfToday = startOfTodayUtc();

  const schedulers = await storage.getOutreachSchedulers();
  const scheduler = schedulers.find((s) => s.id === schedulerId);

  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(
      and(
        eq(patientExecutionCases.assignedTeamMemberId, schedulerId),
        or(
          // active, not yet finished
          and(
            eq(patientExecutionCases.lifecycleStatus, "active"),
            sql`${patientExecutionCases.engagementStatus} NOT IN ('scheduled','completed')`,
          ),
          // finished today
          and(
            inArray(
              patientExecutionCases.engagementStatus,
              COMPLETED_ENGAGEMENT_STATUSES as unknown as string[],
            ),
            sql`${patientExecutionCases.updatedAt} >= ${startOfToday}`,
          ),
        ),
      ),
    )
    .orderBy(desc(patientExecutionCases.lastAttemptAt));

  // Enrich facility via screening → batch (mirrors gatherEligibleCases).
  const screeningIds = Array.from(
    new Set(
      rows
        .map((c) => c.patientScreeningId)
        .filter((id): id is number => id != null),
    ),
  );
  const screenings = screeningIds.length
    ? await db
        .select()
        .from(patientScreenings)
        .where(inArray(patientScreenings.id, screeningIds))
    : [];
  const screeningById = new Map(screenings.map((s) => [s.id, s]));
  const batchIds = Array.from(
    new Set(
      screenings.map((s) => s.batchId).filter((id): id is number => id != null),
    ),
  );
  const batches = batchIds.length
    ? await db
        .select()
        .from(screeningBatches)
        .where(inArray(screeningBatches.id, batchIds))
    : [];
  const batchById = new Map(batches.map((b) => [b.id, b]));

  const counts = { remaining: 0, inProgress: 0, completedToday: 0 };
  const cases: MemberCaseItem[] = [];

  for (const row of rows) {
    const category = categorizeMemberCase(row, startOfToday);
    if (!category) continue;
    if (category === "remaining") counts.remaining += 1;
    else if (category === "in_progress") counts.inProgress += 1;
    else counts.completedToday += 1;

    const screening =
      row.patientScreeningId != null
        ? screeningById.get(row.patientScreeningId)
        : undefined;
    const batch =
      screening?.batchId != null ? batchById.get(screening.batchId) : undefined;
    const facility =
      screening?.facility ?? batch?.facility ?? row.facilityId ?? null;

    cases.push({
      executionCaseId: row.id,
      patientScreeningId: row.patientScreeningId ?? null,
      patientName: row.patientName ?? screening?.name ?? "Unnamed",
      facility,
      engagementStatus: row.engagementStatus ?? null,
      engagementBucket: row.engagementBucket ?? null,
      category,
      lastAttemptAt: toIso(row.lastAttemptAt),
      lastCallOutcome: row.lastCallOutcome ?? null,
      callAttemptCount: row.callAttemptCount ?? 0,
      nextActionAt: toIso(row.nextActionAt),
      updatedAt: toIso(row.updatedAt),
    });
  }

  return {
    schedulerId,
    name: scheduler?.name ?? null,
    counts,
    cases,
    asOf: new Date().toISOString(),
  };
}

// ─── Apply (atomic, re-validated at commit) ─────────────────────────────────

export interface AppliedAssignment {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  schedulerId: number;
  schedulerName: string;
  lane: DistributionLane;
  nextActionAt: string | null;
}

export interface SkippedAssignment {
  executionCaseId: number;
  patientName: string;
  schedulerId: number;
  reason: string;
}

export interface ApplyDistributionResult {
  ok: boolean;
  applied: AppliedAssignment[];
  skipped: SkippedAssignment[];
  summary: {
    proposed: number;
    applied: number;
    skipped: number;
  };
}

const NEW_ENGAGEMENT_STATES = new Set(["new", "ready", "assigned", "not_reached"]);
const TERMINAL_ENGAGEMENT = new Set(["archived", "closed", "cancelled", "completed"]);

function siblingKey(name: string, dob: string | null, scheduleDate: string | null): string {
  return `${name.trim().toLowerCase()}|${dob ?? ""}|${scheduleDate ?? ""}`;
}

/** Optional test seam for {@link applyDistribution}.
 *
 *  Production callers omit this and get the exact previous behavior (the live
 *  global gather). Tests pass scoped gather functions so the atomic write-path
 *  (transaction + SELECT…FOR UPDATE row lock + re-validation + conflict guard)
 *  can be exercised against an isolated, seeded pool of cases/members without
 *  touching the real eligible-case pool or roster. The defaults below are
 *  byte-for-byte the original implementation. */
export interface ApplyDistributionDeps {
  gatherCases?: (exec: DbExecutor) => Promise<DistributionCaseInput[]>;
  gatherMembers?: () => Promise<DistributionMemberInput[]>;
}

/** Re-run the allocator inside a single transaction and commit it atomically.
 *
 *  At commit time every proposed case is re-locked (SELECT … FOR UPDATE) and
 *  re-validated: it must still be unassigned + active. The duplicate-scheduler
 *  guard (no two schedulers share the same patient for the same scheduleDate)
 *  is enforced both against already-committed siblings in the DB and against
 *  siblings placed earlier in this same plan. Because the plan is rebuilt from
 *  freshly-read state inside the transaction, a stale client preview can never
 *  cause an over-assignment. */
export async function applyDistribution(
  actorUserId: string | null,
  assignedRole = "scheduler",
  deps: ApplyDistributionDeps = {},
): Promise<ApplyDistributionResult> {
  const gatherCases = deps.gatherCases ?? gatherEligibleCases;
  const gatherMembers = deps.gatherMembers ?? gatherDistributionMembers;
  // Journey/audit events are collected DURING the transaction but flushed
  // AFTER it commits. Writing them inside the tx would issue an FK insert
  // (FOR KEY SHARE on the parent execution-case row) over a SEPARATE pool
  // connection while the tx still holds FOR UPDATE on that same row — a
  // cross-connection lock wait Postgres cannot resolve, which deadlocks the
  // apply forever. Deferring the (best-effort) audit write past commit keeps
  // the previous "audit failure never rolls back the assignment" semantics.
  const pendingEvents: AppendJourneyEventInput[] = [];
  // Captured from inside the tx so we can sync structured NEEDS COVERAGE state
  // (K8) after commit — cases the allocator could not place enter needs-coverage
  // instead of being silently dropped (overflow, req 14).
  let planUnplaced: UnplacedCase[] = [];
  const result = await db.transaction(async (tx) => {
    const [cases, members] = await Promise.all([
      gatherCases(tx),
      gatherMembers(),
    ]);
    const plan = buildDistributionPlan(cases, members);
    planUnplaced = plan.unplaced;
    const memberById = new Map(members.map((m) => [m.schedulerId, m]));

    const applied: AppliedAssignment[] = [];
    const skipped: SkippedAssignment[] = [];
    // Tracks (name|dob|date) → schedulerId committed so intra-plan siblings
    // never split across two schedulers for the same date.
    const committedSibling = new Map<string, number>();

    for (const a of plan.assignments) {
      const member = memberById.get(a.schedulerId);
      if (!member) {
        skipped.push({
          executionCaseId: a.executionCaseId,
          patientName: a.patientName,
          schedulerId: a.schedulerId,
          reason: "Proposed team member no longer exists.",
        });
        continue;
      }

      // Lock the case row, then re-read its current state under the lock.
      await tx.execute(
        sql`SELECT id FROM patient_execution_cases WHERE id = ${a.executionCaseId} FOR UPDATE`,
      );
      const [row] = await tx
        .select()
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.id, a.executionCaseId))
        .limit(1);

      if (!row) {
        skipped.push({
          executionCaseId: a.executionCaseId,
          patientName: a.patientName,
          schedulerId: a.schedulerId,
          reason: "Case no longer exists.",
        });
        continue;
      }
      if (row.assignedTeamMemberId != null) {
        skipped.push({
          executionCaseId: a.executionCaseId,
          patientName: a.patientName,
          schedulerId: a.schedulerId,
          reason: "Case was assigned by someone else before apply.",
        });
        continue;
      }
      if (row.lifecycleStatus && row.lifecycleStatus !== "active") {
        skipped.push({
          executionCaseId: a.executionCaseId,
          patientName: a.patientName,
          schedulerId: a.schedulerId,
          reason: "Case is no longer active.",
        });
        continue;
      }
      if (row.engagementStatus && TERMINAL_ENGAGEMENT.has(row.engagementStatus)) {
        skipped.push({
          executionCaseId: a.executionCaseId,
          patientName: a.patientName,
          schedulerId: a.schedulerId,
          reason: "Case reached a terminal status before apply.",
        });
        continue;
      }

      // Duplicate-scheduler-per-date guard. Outreach / null-date cases are
      // exempt (mirrors the assignment-board conflict guard).
      const key = siblingKey(a.patientName, a.patientDob, a.scheduleDate);
      if (a.scheduleDate) {
        const inPlan = committedSibling.get(key);
        if (inPlan != null && inPlan !== a.schedulerId) {
          skipped.push({
            executionCaseId: a.executionCaseId,
            patientName: a.patientName,
            schedulerId: a.schedulerId,
            reason: "Sibling case for the same date is going to another team member.",
          });
          continue;
        }
        const conflict = await findConflictingSibling(
          tx,
          a.executionCaseId,
          a.patientName,
          a.patientDob,
          a.scheduleDate,
          a.schedulerId,
        );
        if (conflict) {
          skipped.push({
            executionCaseId: a.executionCaseId,
            patientName: a.patientName,
            schedulerId: a.schedulerId,
            reason: `Already assigned to another team member for ${a.scheduleDate}.`,
          });
          continue;
        }
      }

      const now = new Date();
      const nextStatus = NEW_ENGAGEMENT_STATES.has(row.engagementStatus ?? "")
        ? "assigned"
        : row.engagementStatus;
      const { nextActionAt } = calculateNextActionAt({ isAssignment: true, now });

      await tx
        .update(patientExecutionCases)
        .set({
          assignedTeamMemberId: a.schedulerId,
          assignedRole,
          engagementStatus: nextStatus,
          nextActionAt: nextActionAt ?? undefined,
          updatedAt: now,
        })
        .where(eq(patientExecutionCases.id, a.executionCaseId));

      pendingEvents.push({
        patientScreeningId: a.patientScreeningId,
        executionCaseId: a.executionCaseId,
        actorUserId,
        patientName: a.patientName,
        patientDob: a.patientDob,
        eventType: "engagement_assignment_changed",
        eventSource: "engagement_distribution",
        summary: `Auto-distributed to ${a.schedulerName}`,
        metadata: {
          newSchedulerId: a.schedulerId,
          newSchedulerName: a.schedulerName,
          assignedRole,
          lane: a.lane,
          distribution: true,
          nextActionAt: nextActionAt ? nextActionAt.toISOString() : null,
        },
      });

      if (a.scheduleDate) committedSibling.set(key, a.schedulerId);
      applied.push({
        executionCaseId: a.executionCaseId,
        patientScreeningId: a.patientScreeningId,
        patientName: a.patientName,
        schedulerId: a.schedulerId,
        schedulerName: a.schedulerName,
        lane: a.lane,
        nextActionAt: nextActionAt ? nextActionAt.toISOString() : null,
      });
    }

    return {
      ok: skipped.length === 0,
      applied,
      skipped,
      summary: {
        proposed: plan.assignments.length,
        applied: applied.length,
        skipped: skipped.length,
      },
    };
  });

  // Flush audit events now that the FOR UPDATE row locks are released
  // (post-commit). Best-effort: a failed audit write never undoes a
  // committed assignment.
  for (const ev of pendingEvents) {
    try {
      await appendJourneyEvent(ev);
    } catch (err) {
      console.error(
        "[engagement/distribution] journey append failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Sync structured NEEDS COVERAGE (K8, req 14) — post-commit, best-effort.
  // Cases that got an owner are resolved; cases the allocator could not place
  // are recorded with a structured category so nothing is silently dropped.
  try {
    const appliedIds = result.applied.map((a) => a.executionCaseId);
    if (appliedIds.length > 0) {
      await needsCoverageRepository.resolveForCases(appliedIds, actorUserId);
    }
    for (const u of planUnplaced) {
      await needsCoverageRepository.upsert({
        executionCaseId: u.executionCaseId,
        patientScreeningId: u.patientScreeningId ?? null,
        facilityId: u.facility ?? null,
        category: u.category,
        reason: u.reason,
        source: "distribution",
        metadata: { lane: u.lane },
      });
    }
  } catch (err) {
    console.error(
      "[engagement/distribution] needs-coverage sync failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  return result;
}

/** Is there an ACTIVE execution case for the same patient (name + DOB) on the
 *  same scheduleDate already assigned to a DIFFERENT team member? Resolves each
 *  candidate sibling's scheduleDate via the screening → batch spine. */
async function findConflictingSibling(
  exec: DbExecutor,
  selfCaseId: number,
  name: string,
  dob: string | null,
  scheduleDate: string,
  proposedSchedulerId: number,
): Promise<boolean> {
  const siblings = await exec
    .select()
    .from(patientExecutionCases)
    .where(
      and(
        ne(patientExecutionCases.id, selfCaseId),
        isNotNull(patientExecutionCases.assignedTeamMemberId),
        sql`lower(${patientExecutionCases.patientName}) = ${name.trim().toLowerCase()}`,
        dob
          ? eq(patientExecutionCases.patientDob, dob)
          : isNull(patientExecutionCases.patientDob),
        or(
          isNull(patientExecutionCases.lifecycleStatus),
          eq(patientExecutionCases.lifecycleStatus, "active"),
        ),
      ),
    );

  for (const sib of siblings) {
    if (sib.assignedTeamMemberId === proposedSchedulerId) continue;
    if (sib.patientScreeningId == null) continue;
    const [screening] = await exec
      .select()
      .from(patientScreenings)
      .where(eq(patientScreenings.id, sib.patientScreeningId))
      .limit(1);
    if (!screening?.batchId) continue;
    const [batch] = await exec
      .select()
      .from(screeningBatches)
      .where(eq(screeningBatches.id, screening.batchId))
      .limit(1);
    if ((batch?.scheduleDate ?? null) === scheduleDate) return true;
  }
  return false;
}
