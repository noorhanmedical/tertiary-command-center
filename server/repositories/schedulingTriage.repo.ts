import { db } from "../db";
import { eq, and, desc, notInArray } from "drizzle-orm";
import {
  schedulingTriageCases,
  type SchedulingTriageCase,
  type InsertSchedulingTriageCase,
} from "@shared/schema/schedulingTriage";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";

// Statuses that mean "this triage row is settled". When matching open rows
// for dedup, we ignore rows in these terminal states — a new call result
// that needs follow-up should NOT reuse a closed row.
const TERMINAL_TRIAGE_STATUSES = ["resolved", "closed", "cancelled"] as const;

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

/** Idempotent open-triage write. Looks up an open row matching
 *  (patientScreeningId, mainType, subtype) — where "open" means status is
 *  NOT IN (resolved, closed, cancelled) — and updates it in place. Falls
 *  back to executionCaseId when patientScreeningId is null. Inserts a
 *  fresh row only when no matching open row exists.
 *
 *  Mirrors the audit's duplicate-key check
 *  (auditCanonicalIntegrity.ts: "duplicate open triage per
 *  (patient_screening_id, main_type, subtype)") so repeated callback /
 *  manager_review writes can no longer produce duplicate WARN rows.
 *
 *  Metadata is merged: existing keys are preserved, new keys overwrite
 *  matching keys. dueAt / note / priority / nextOwnerRole / assignedUserId
 *  are overwritten when supplied. */
export async function upsertOpenSchedulingTriageCase(
  input: InsertSchedulingTriageCase,
): Promise<{ row: SchedulingTriageCase; created: boolean }> {
  const conditions = [
    eq(schedulingTriageCases.mainType, input.mainType),
    notInArray(schedulingTriageCases.status, [...TERMINAL_TRIAGE_STATUSES]),
  ];
  if (input.subtype !== undefined && input.subtype !== null) {
    conditions.push(eq(schedulingTriageCases.subtype, input.subtype));
  }
  if (input.patientScreeningId != null) {
    conditions.push(eq(schedulingTriageCases.patientScreeningId, input.patientScreeningId));
  } else if (input.executionCaseId != null) {
    conditions.push(eq(schedulingTriageCases.executionCaseId, input.executionCaseId));
  } else {
    // No strong identifier — cannot dedupe safely. Fall through to insert.
    const inserted = await createSchedulingTriageCase(input);
    return { row: inserted, created: true };
  }

  const [existing] = await db
    .select()
    .from(schedulingTriageCases)
    .where(and(...conditions))
    .orderBy(desc(schedulingTriageCases.id))
    .limit(1);

  if (existing) {
    const existingMetadata = (typeof existing.metadata === "object" && existing.metadata !== null
      ? (existing.metadata as Record<string, unknown>)
      : {});
    const incomingMetadata = (typeof input.metadata === "object" && input.metadata !== null
      ? (input.metadata as Record<string, unknown>)
      : {});
    const mergedMetadata = { ...existingMetadata, ...incomingMetadata };

    const updates: Partial<InsertSchedulingTriageCase> = {
      // Always merge metadata
      metadata: mergedMetadata,
    };
    // Only overwrite scalar fields when the caller supplied them — otherwise
    // preserve whatever the existing row had so prior context isn't dropped.
    if (input.dueAt !== undefined) updates.dueAt = input.dueAt;
    if (input.note !== undefined && input.note !== null) updates.note = input.note;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.nextOwnerRole !== undefined) updates.nextOwnerRole = input.nextOwnerRole;
    if (input.assignedUserId !== undefined && input.assignedUserId !== null) {
      updates.assignedUserId = input.assignedUserId;
    }
    if (input.facilityId !== undefined && input.facilityId !== null && existing.facilityId == null) {
      updates.facilityId = input.facilityId;
    }
    if (input.executionCaseId !== undefined && input.executionCaseId !== null && existing.executionCaseId == null) {
      updates.executionCaseId = input.executionCaseId;
    }

    const updated = await updateSchedulingTriageCase(existing.id, updates);
    return { row: updated ?? existing, created: false };
  }

  const inserted = await createSchedulingTriageCase(input);
  return { row: inserted, created: true };
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
