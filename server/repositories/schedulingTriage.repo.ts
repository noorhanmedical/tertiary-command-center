import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  schedulingTriageCases,
  type SchedulingTriageCase,
  type InsertSchedulingTriageCase,
} from "@shared/schema/schedulingTriage";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";

const TRIAGE_TRIGGER_STATUSES = new Set([
  "no_show",
  "cancelled",
  "cancellation",
  "reschedule_needed",
]);

type TriageMapping = {
  mainType: string;
  subtype: string;
  nextOwnerRole: string;
};

function triageMappingForStatus(status: string): TriageMapping | null {
  if (status === "no_show") {
    return { mainType: "no_show_recovery", subtype: "patient_no_showed", nextOwnerRole: "scheduler" };
  }
  if (status === "cancelled" || status === "cancellation") {
    return { mainType: "cancellation_recovery", subtype: "needs_rebooking_after_cancellation", nextOwnerRole: "scheduler" };
  }
  if (status === "reschedule_needed") {
    return { mainType: "reschedule", subtype: "needs_new_date", nextOwnerRole: "scheduler" };
  }
  return null;
}

/** Create a scheduling triage case from a global schedule event that has
 *  transitioned to a triggering status (no_show, cancelled, cancellation,
 *  reschedule_needed). Idempotent: if a case already exists for the same
 *  globalScheduleEventId + mainType it is returned unchanged. */
export async function createSchedulingTriageCaseFromScheduleEvent(
  event: GlobalScheduleEvent,
): Promise<SchedulingTriageCase | null> {
  if (!TRIAGE_TRIGGER_STATUSES.has(event.status)) return null;

  const mapping = triageMappingForStatus(event.status);
  if (!mapping) return null;

  // Deduplicate: one triage case per (globalScheduleEventId, mainType)
  const [existing] = await db
    .select()
    .from(schedulingTriageCases)
    .where(
      and(
        eq(schedulingTriageCases.globalScheduleEventId, event.id),
        eq(schedulingTriageCases.mainType, mapping.mainType),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(schedulingTriageCases)
    .values({
      globalScheduleEventId: event.id,
      executionCaseId: event.executionCaseId ?? undefined,
      patientScreeningId: event.patientScreeningId ?? undefined,
      patientName: event.patientName ?? undefined,
      patientDob: event.patientDob ?? undefined,
      facilityId: event.facilityId ?? undefined,
      mainType: mapping.mainType,
      subtype: mapping.subtype,
      status: "open",
      priority: "normal",
      nextOwnerRole: mapping.nextOwnerRole,
      metadata: {
        globalScheduleEventId: event.id,
        executionCaseId: event.executionCaseId ?? null,
        patientScreeningId: event.patientScreeningId ?? null,
        facilityId: event.facilityId ?? null,
        eventStatus: event.status,
        createdSource: "global_schedule_status_change",
      },
    })
    .returning();

  return created;
}

export type ListSchedulingTriageCasesFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  globalScheduleEventId?: number;
  facilityId?: string;
  mainType?: string;
  subtype?: string;
  status?: string;
  assignedUserId?: string;
  nextOwnerRole?: string;
};

export async function createSchedulingTriageCase(
  input: InsertSchedulingTriageCase,
): Promise<SchedulingTriageCase> {
  const [result] = await db
    .insert(schedulingTriageCases)
    .values(input)
    .returning();
  return result;
}

export async function updateSchedulingTriageCase(
  id: number,
  updates: Partial<InsertSchedulingTriageCase>,
): Promise<SchedulingTriageCase | undefined> {
  const [result] = await db
    .update(schedulingTriageCases)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schedulingTriageCases.id, id))
    .returning();
  return result;
}

export async function getSchedulingTriageCaseById(id: number): Promise<SchedulingTriageCase | undefined> {
  const [result] = await db
    .select()
    .from(schedulingTriageCases)
    .where(eq(schedulingTriageCases.id, id))
    .limit(1);
  return result;
}

export async function listSchedulingTriageCases(
  filters: ListSchedulingTriageCasesFilters = {},
  limit = 100,
): Promise<SchedulingTriageCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(schedulingTriageCases.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(schedulingTriageCases.patientScreeningId, filters.patientScreeningId));
  if (filters.globalScheduleEventId != null) conditions.push(eq(schedulingTriageCases.globalScheduleEventId, filters.globalScheduleEventId));
  if (filters.facilityId) conditions.push(eq(schedulingTriageCases.facilityId, filters.facilityId));
  if (filters.mainType) conditions.push(eq(schedulingTriageCases.mainType, filters.mainType));
  if (filters.subtype) conditions.push(eq(schedulingTriageCases.subtype, filters.subtype));
  if (filters.status) conditions.push(eq(schedulingTriageCases.status, filters.status));
  if (filters.assignedUserId) conditions.push(eq(schedulingTriageCases.assignedUserId, filters.assignedUserId));
  if (filters.nextOwnerRole) conditions.push(eq(schedulingTriageCases.nextOwnerRole, filters.nextOwnerRole));

  const query = db.select().from(schedulingTriageCases).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(schedulingTriageCases.createdAt)).limit(safeLimit)
    : query.orderBy(desc(schedulingTriageCases.createdAt)).limit(safeLimit);
}
