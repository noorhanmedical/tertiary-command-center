import { db } from "../db";
import { eq, and, desc, sql, inArray, notInArray } from "drizzle-orm";
import {
  patientExecutionCases,
  patientJourneyEvents,
  type PatientExecutionCase,
  type PatientJourneyEvent,
  type InsertPatientJourneyEvent,
} from "@shared/schema/executionCase";
import { insuranceEligibilityReviews } from "@shared/schema/insuranceEligibility";
import type { PatientScreening } from "@shared/schema/screening";
import {
  getEngagementCenterDefaults,
  getInsurancePriorityDefaults,
  type EngagementCenterDefaults,
  type InsurancePriorityWeights,
} from "./adminSettings.repo";

// ─── Settings-driven priority scoring ──────────────────────────────────────

const TERMINAL_LIFECYCLE_STATUSES = ["closed", "inactive", "archived"] as const;
const TERMINAL_ENGAGEMENT_STATUSES = ["completed", "closed"] as const;

export type EngagementPriorityContext = {
  bucketWeights: Record<string, number>;
  insuranceWeights: InsurancePriorityWeights;
  insurancePriorityByScreening: Map<number, string>;
  nextActionWindowMinutes: number;
};

/** Compute a settings-driven priority score for a single execution case.
 *  Higher = surface earlier. Combines bucket weight, insurance class,
 *  qualification, explicit priorityScore column, and next-action proximity.
 *  This is a pure function; the caller owns DB I/O and bulk fetches. */
export function calculateEngagementCasePriority(
  caseRow: PatientExecutionCase,
  context: EngagementPriorityContext,
): number {
  let score = 0;

  // Bucket weight (visit > scheduling_triage > outreach by default)
  score += (context.bucketWeights[caseRow.engagementBucket ?? ""] ?? 0) * 100;

  // Insurance priority — looked up by patientScreeningId via the bulk map
  if (caseRow.patientScreeningId != null) {
    const klass = context.insurancePriorityByScreening.get(caseRow.patientScreeningId);
    if (klass) {
      const w = (context.insuranceWeights as Record<string, number>)[klass] ?? 0;
      score += w * 30;
    }
  }

  // Qualification
  if (caseRow.qualificationStatus === "qualified") score += 50;

  // Explicit priorityScore column gives a baseline boost
  if (typeof caseRow.priorityScore === "number" && Number.isFinite(caseRow.priorityScore)) {
    score += caseRow.priorityScore;
  }

  // Next-action proximity — overdue or within window gets a boost
  if (caseRow.nextActionAt) {
    const dt = caseRow.nextActionAt instanceof Date
      ? caseRow.nextActionAt
      : new Date(caseRow.nextActionAt as unknown as string);
    const t = dt.getTime();
    if (Number.isFinite(t)) {
      const minutesUntil = (t - Date.now()) / 60_000;
      if (minutesUntil <= 0) score += 200;          // overdue
      else if (minutesUntil < context.nextActionWindowMinutes) score += 100;
      else score += Math.max(0, 50 - Math.floor(minutesUntil / 60));
    }
  }

  return score;
}

/** Bulk-fetch insurance priorityClass per patientScreeningId. Used to
 *  populate the priority context without N+1 lookups during ranking. */
async function bulkInsurancePriorityByScreening(
  screeningIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (screeningIds.length === 0) return out;
  const rows = await db
    .select({
      psid: insuranceEligibilityReviews.patientScreeningId,
      pc: insuranceEligibilityReviews.priorityClass,
    })
    .from(insuranceEligibilityReviews)
    .where(inArray(insuranceEligibilityReviews.patientScreeningId, screeningIds));
  for (const r of rows) {
    if (r.psid != null && r.pc) out.set(r.psid, r.pc);
  }
  return out;
}

/** Build the priority context (bucket weights, insurance weights, screening
 *  → priorityClass map, next-action window) by reading admin_settings + the
 *  insurance reviews for the caller-supplied screeningIds. */
async function buildEngagementPriorityContext(
  screeningIds: number[],
  defaults?: EngagementCenterDefaults,
): Promise<EngagementPriorityContext> {
  const [defs, insuranceWeights, insuranceMap] = await Promise.all([
    defaults ? Promise.resolve(defaults) : getEngagementCenterDefaults(),
    getInsurancePriorityDefaults(),
    bulkInsurancePriorityByScreening(screeningIds),
  ]);
  return {
    bucketWeights: defs.bucketWeights,
    insuranceWeights,
    insurancePriorityByScreening: insuranceMap,
    nextActionWindowMinutes: defs.nextActionWindowMinutes,
  };
}

/** Stable comparator implementing the spec sort order:
 *    1. priorityScore DESC NULLS LAST (column)
 *    2. calculated priority DESC (settings-driven)
 *    3. nextActionAt ASC NULLS LAST
 *    4. createdAt DESC */
function sortByEngagementPriority<T extends PatientExecutionCase>(
  rows: T[],
  scores: Map<number, number>,
): T[] {
  const list = [...rows];
  list.sort((a, b) => {
    const aPS = a.priorityScore ?? Number.NEGATIVE_INFINITY;
    const bPS = b.priorityScore ?? Number.NEGATIVE_INFINITY;
    if (aPS !== bPS) return bPS - aPS;

    const aCalc = scores.get(a.id) ?? 0;
    const bCalc = scores.get(b.id) ?? 0;
    if (aCalc !== bCalc) return bCalc - aCalc;

    const aNAA = a.nextActionAt ? new Date(a.nextActionAt as unknown as string).getTime() : Number.POSITIVE_INFINITY;
    const bNAA = b.nextActionAt ? new Date(b.nextActionAt as unknown as string).getTime() : Number.POSITIVE_INFINITY;
    if (aNAA !== bNAA) return aNAA - bNAA;

    const aCA = a.createdAt ? new Date(a.createdAt as unknown as string).getTime() : 0;
    const bCA = b.createdAt ? new Date(b.createdAt as unknown as string).getTime() : 0;
    return bCA - aCA;
  });
  return list;
}

function deriveEngagementBucket(screening: PatientScreening): "visit" | "outreach" | "scheduling_triage" {
  const t = (screening.patientType ?? "visit").toLowerCase();
  if (t === "outreach") return "outreach";
  if (t === "visit") return "visit";
  return "scheduling_triage";
}

function deriveQualificationStatus(screening: PatientScreening): "qualified" | "not_qualified" | "unscreened" {
  const tests = screening.qualifyingTests ?? [];
  if (screening.status === "completed") {
    return tests.length > 0 ? "qualified" : "not_qualified";
  }
  return "unscreened";
}

export async function createOrUpdateExecutionCaseFromScreening(
  screening: PatientScreening,
  actorUserId: string | null,
): Promise<{ executionCase: PatientExecutionCase; created: boolean }> {
  const [existing] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, screening.id))
    .limit(1);

  const engagementBucket = deriveEngagementBucket(screening);
  const qualificationStatus = deriveQualificationStatus(screening);
  const selectedServices = Array.isArray(screening.qualifyingTests) && screening.qualifyingTests.length > 0
    ? (screening.qualifyingTests as string[])
    : undefined;

  if (existing) {
    const [updated] = await db
      .update(patientExecutionCases)
      .set({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        facilityId: screening.facility ?? undefined,
        engagementBucket,
        qualificationStatus,
        selectedServices,
        updatedAt: new Date(),
      })
      .where(eq(patientExecutionCases.id, existing.id))
      .returning();
    return { executionCase: updated, created: false };
  }

  const [created] = await db
    .insert(patientExecutionCases)
    .values({
      patientScreeningId: screening.id,
      patientName: screening.name,
      patientDob: screening.dob ?? undefined,
      facilityId: screening.facility ?? undefined,
      source: "system_generated",
      engagementBucket,
      qualificationStatus,
      lifecycleStatus: "active",
      engagementStatus: "new",
      selectedServices,
    })
    .returning();

  return { executionCase: created, created: true };
}

export async function appendPatientJourneyEvent(
  event: InsertPatientJourneyEvent,
): Promise<PatientJourneyEvent> {
  const [result] = await db
    .insert(patientJourneyEvents)
    .values(event)
    .returning();
  return result;
}

export type ListExecutionCasesFilters = {
  engagementBucket?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  facilityId?: string;
  patientScreeningId?: number;
};

export async function listExecutionCases(
  filters: ListExecutionCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];
  if (filters.engagementBucket) conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  if (filters.lifecycleStatus) conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.engagementStatus) conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  if (filters.facilityId) conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  if (filters.patientScreeningId != null) conditions.push(eq(patientExecutionCases.patientScreeningId, filters.patientScreeningId));

  const query = db.select().from(patientExecutionCases)
    .$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(patientExecutionCases.createdAt)).limit(safeLimit)
    : query.orderBy(desc(patientExecutionCases.createdAt)).limit(safeLimit);
}

export async function getExecutionCaseById(id: number): Promise<PatientExecutionCase | undefined> {
  const [result] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, id))
    .limit(1);
  return result;
}

export async function getExecutionCaseByScreeningId(screeningId: number): Promise<PatientExecutionCase | undefined> {
  const [result] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, screeningId))
    .limit(1);
  return result;
}

export type ListEngagementCenterCasesFilters = {
  engagementBucket?: string;
  facilityId?: string;
  assignedTeamMemberId?: number;
  assignedRole?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  qualificationStatus?: string;
};

/** Engagement Center read: executes against patient_execution_cases.
 *  Default exclusions (when caller doesn't specify):
 *    lifecycleStatus NOT IN (closed, inactive, archived)
 *    engagementStatus NOT IN (completed, closed)
 *  After fetch, the rows are re-sorted in JS using the settings-driven
 *  priority comparator (bucket weight → insurance priority → next-action
 *  proximity → priorityScore column → createdAt). Returns up to safeLimit
 *  rows (default 100, max 500). */
export async function listEngagementCenterCases(
  filters: ListEngagementCenterCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];
  if (filters.engagementBucket) conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  if (filters.facilityId) conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  if (filters.assignedTeamMemberId != null) conditions.push(eq(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberId));
  if (filters.assignedRole) conditions.push(eq(patientExecutionCases.assignedRole, filters.assignedRole));
  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  if (filters.lifecycleStatus) {
    conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.lifecycleStatus, [...TERMINAL_LIFECYCLE_STATUSES]));
  }
  if (filters.engagementStatus) {
    conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.engagementStatus, [...TERMINAL_ENGAGEMENT_STATUSES]));
  }

  const query = db.select().from(patientExecutionCases).$dynamic();
  const orderClause = [
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  const rows = await query.where(and(...conditions)).orderBy(...orderClause).limit(safeLimit);

  // Settings-driven priority refinement (in JS — applied on top of the SQL
  // ordering so DB-side index access still wins for the initial slice).
  const screeningIds = rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null);
  const ctx = await buildEngagementPriorityContext(screeningIds);
  const scores = new Map<number, number>();
  for (const r of rows) scores.set(r.id, calculateEngagementCasePriority(r, ctx));
  return sortByEngagementPriority(rows, scores);
}

export type ListSchedulerPortalCasesFilters = {
  assignedTeamMemberId?: number;
  facilityId?: string;
  engagementBucket?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  qualificationStatus?: string;
};

const SCHEDULER_DEFAULT_BUCKETS = ["visit", "outreach", "scheduling_triage"] as const;
const SCHEDULER_TERMINAL_ENGAGEMENT_STATUSES = ["completed", "closed"] as const;

/** Scheduler Portal read: defaults to scheduler-relevant buckets and excludes
 *  terminal engagement statuses when caller does not override. Ordered by
 *  nextActionAt ASC NULLS LAST, priorityScore DESC NULLS LAST, createdAt DESC. */
export async function listSchedulerPortalCases(
  filters: ListSchedulerPortalCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.engagementBucket) {
    conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  } else {
    conditions.push(inArray(patientExecutionCases.engagementBucket, [...SCHEDULER_DEFAULT_BUCKETS]));
  }

  if (filters.engagementStatus) {
    conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.engagementStatus, [...SCHEDULER_TERMINAL_ENGAGEMENT_STATUSES]));
  }

  if (filters.assignedTeamMemberId != null) conditions.push(eq(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberId));
  if (filters.facilityId) conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  if (filters.lifecycleStatus) {
    conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.lifecycleStatus, [...TERMINAL_LIFECYCLE_STATUSES]));
  }

  const query = db.select().from(patientExecutionCases).$dynamic();
  const orderClause = [
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  const rows = await query.where(and(...conditions)).orderBy(...orderClause).limit(safeLimit);

  // Settings-driven priority refinement (in JS).
  const screeningIds = rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null);
  const ctx = await buildEngagementPriorityContext(screeningIds);
  const scores = new Map<number, number>();
  for (const r of rows) scores.set(r.id, calculateEngagementCasePriority(r, ctx));
  return sortByEngagementPriority(rows, scores);
}

// ─── Engagement assignment write-side ──────────────────────────────────────

const SCHEDULER_ASSIGNMENT_BUCKETS = ["visit", "outreach", "scheduling_triage"] as const;
const LIAISON_ASSIGNMENT_BUCKETS = ["visit", "outreach"] as const;

export type EngagementTargetRole = "scheduler" | "liaison";

export type AssignEngagementCasesInput = {
  facilityId?: string;
  targetRole: EngagementTargetRole;
  limit?: number;
  assignedTeamMemberId?: number;
  dryRun?: boolean;
};

export type AssignEngagementCasePreview = {
  id: number;
  patientName: string;
  patientScreeningId: number | null;
  facilityId: string | null;
  engagementBucket: string;
  qualificationStatus: string;
  previousAssignedRole: string | null;
  previousAssignedTeamMemberId: number | null;
  previousEngagementStatus: string;
  proposedAssignedRole: EngagementTargetRole;
  proposedAssignedTeamMemberId: number | null;
  proposedEngagementStatus: string;
  applied: boolean;
};

export type AssignEngagementCasesResult = {
  dryRun: boolean;
  targetRole: EngagementTargetRole;
  count: number;
  cases: AssignEngagementCasePreview[];
};

/** Selection-and-assignment for active qualified execution cases.
 *
 *  Selection rules:
 *    lifecycleStatus = "active"
 *    qualificationStatus = "qualified"
 *    engagementStatus NOT IN (completed, closed)
 *    engagementBucket IN (scheduler: visit/outreach/scheduling_triage,
 *                        liaison: visit/outreach)
 *    facilityId = input.facilityId (when provided)
 *
 *  Ordering: same settings-driven priority refinement as
 *  listEngagementCenterCases (priorityScore DESC NULLS LAST → calculated
 *  priority DESC → nextActionAt ASC NULLS LAST → createdAt DESC).
 *
 *  Write behavior (dryRun=false):
 *    - assignedRole = targetRole
 *    - assignedTeamMemberId = input.assignedTeamMemberId WHEN PROVIDED
 *      (otherwise the existing value is preserved — owner continuity)
 *    - engagementStatus = "in_progress" iff current is "new" or "ready"
 *    - updatedAt = now
 *    - patient_journey_events row appended:
 *        eventType="engagement_assigned" eventSource="engagement_center"
 *        metadata={ targetRole, assignedTeamMemberId, dryRun: false } */
export async function assignEngagementCases(
  input: AssignEngagementCasesInput,
): Promise<AssignEngagementCasesResult> {
  const limit = Math.min(Math.max(1, input.limit ?? 25), 250);
  const dryRun = input.dryRun ?? false;
  const buckets = input.targetRole === "scheduler"
    ? [...SCHEDULER_ASSIGNMENT_BUCKETS]
    : [...LIAISON_ASSIGNMENT_BUCKETS];

  const conditions = [
    eq(patientExecutionCases.lifecycleStatus, "active"),
    eq(patientExecutionCases.qualificationStatus, "qualified"),
    notInArray(patientExecutionCases.engagementStatus, [...TERMINAL_ENGAGEMENT_STATUSES]),
    inArray(patientExecutionCases.engagementBucket, buckets),
  ];
  if (input.facilityId) conditions.push(eq(patientExecutionCases.facilityId, input.facilityId));

  const orderClause = [
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(and(...conditions))
    .orderBy(...orderClause)
    .limit(limit);

  // JS-side priority refinement (matches the read endpoints' contract)
  const screeningIds = rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null);
  const ctx = await buildEngagementPriorityContext(screeningIds);
  const scores = new Map<number, number>();
  for (const r of rows) scores.set(r.id, calculateEngagementCasePriority(r, ctx));
  const sorted = sortByEngagementPriority(rows, scores);

  const explicitTeamMember = input.assignedTeamMemberId !== undefined;
  const cases: AssignEngagementCasePreview[] = [];

  for (const row of sorted) {
    const proposedStatus = (row.engagementStatus === "new" || row.engagementStatus === "ready")
      ? "in_progress"
      : row.engagementStatus;
    const proposedAssignedTeamMemberId = explicitTeamMember
      ? (input.assignedTeamMemberId ?? null)
      : (row.assignedTeamMemberId ?? null);

    let applied = false;
    if (!dryRun) {
      const setFields: Record<string, unknown> = {
        assignedRole: input.targetRole,
        engagementStatus: proposedStatus,
        updatedAt: new Date(),
      };
      // Owner continuity — only touch assignedTeamMemberId when the caller
      // supplied a specific value. Omitting it preserves whatever was there.
      if (explicitTeamMember) {
        setFields.assignedTeamMemberId = input.assignedTeamMemberId;
      }

      const [updated] = await db
        .update(patientExecutionCases)
        .set(setFields)
        .where(eq(patientExecutionCases.id, row.id))
        .returning();

      if (updated) {
        applied = true;
        try {
          await appendPatientJourneyEvent({
            patientName: updated.patientName,
            patientDob: updated.patientDob ?? undefined,
            patientScreeningId: updated.patientScreeningId ?? undefined,
            executionCaseId: updated.id,
            eventType: "engagement_assigned",
            eventSource: "engagement_center",
            actorUserId: null,
            summary: `Assigned to ${input.targetRole}`,
            metadata: {
              targetRole: input.targetRole,
              assignedTeamMemberId: input.assignedTeamMemberId ?? null,
              previousAssignedRole: row.assignedRole ?? null,
              previousAssignedTeamMemberId: row.assignedTeamMemberId ?? null,
              previousEngagementStatus: row.engagementStatus,
              proposedEngagementStatus: proposedStatus,
              dryRun: false,
            },
          });
        } catch (err) {
          // Journey event append is best-effort — never undo the assignment
          // because of a logging miss.
          console.error("[assignEngagementCases] journey event append failed:", err);
        }
      }
    }

    cases.push({
      id: row.id,
      patientName: row.patientName,
      patientScreeningId: row.patientScreeningId ?? null,
      facilityId: row.facilityId ?? null,
      engagementBucket: row.engagementBucket,
      qualificationStatus: row.qualificationStatus,
      previousAssignedRole: row.assignedRole ?? null,
      previousAssignedTeamMemberId: row.assignedTeamMemberId ?? null,
      previousEngagementStatus: row.engagementStatus,
      proposedAssignedRole: input.targetRole,
      proposedAssignedTeamMemberId,
      proposedEngagementStatus: proposedStatus,
      applied,
    });
  }

  return { dryRun, targetRole: input.targetRole, count: cases.length, cases };
}

export type ListJourneyEventsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  patientName?: string;
  patientDob?: string;
  eventType?: string;
};

export async function listJourneyEvents(
  filters: ListJourneyEventsFilters = {},
  limit = 100,
): Promise<PatientJourneyEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];
  if (filters.executionCaseId != null) conditions.push(eq(patientJourneyEvents.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(patientJourneyEvents.patientScreeningId, filters.patientScreeningId));
  if (filters.patientName) conditions.push(eq(patientJourneyEvents.patientName, filters.patientName));
  if (filters.patientDob) conditions.push(eq(patientJourneyEvents.patientDob, filters.patientDob));
  if (filters.eventType) conditions.push(eq(patientJourneyEvents.eventType, filters.eventType));

  const query = db.select().from(patientJourneyEvents)
    .$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(patientJourneyEvents.createdAt)).limit(safeLimit)
    : query.orderBy(desc(patientJourneyEvents.createdAt)).limit(safeLimit);
}
