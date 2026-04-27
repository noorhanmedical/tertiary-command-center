import { db } from "../db";
import { eq, and, desc, sql, inArray, notInArray } from "drizzle-orm";
import {
  patientExecutionCases,
  patientJourneyEvents,
  type PatientExecutionCase,
  type PatientJourneyEvent,
  type InsertPatientJourneyEvent,
} from "@shared/schema/executionCase";
import type { PatientScreening } from "@shared/schema/screening";

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

/** Engagement Center read: executes against patient_execution_cases ordered by
 *  priorityScore DESC (NULLS LAST), then nextActionAt ASC (NULLS LAST), then
 *  createdAt DESC. Returns up to safeLimit rows (default 100, max 500). */
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
  if (filters.lifecycleStatus) conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.engagementStatus) conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  const query = db.select().from(patientExecutionCases).$dynamic();
  const orderClause = [
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(...orderClause).limit(safeLimit)
    : query.orderBy(...orderClause).limit(safeLimit);
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
  if (filters.lifecycleStatus) conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  const query = db.select().from(patientExecutionCases).$dynamic();
  const orderClause = [
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  return query.where(and(...conditions)).orderBy(...orderClause).limit(safeLimit);
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
