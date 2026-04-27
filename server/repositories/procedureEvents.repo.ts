import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  procedureEvents,
  type ProcedureEvent,
  type InsertProcedureEvent,
} from "@shared/schema/procedureEvents";
import { upsertCaseDocumentReadinessForProcedureComplete } from "./documentReadiness.repo";
import { createPendingProcedureNotes } from "./generatedNotes.repo";
import { evaluateBillingReadinessForProcedure } from "./billingReadiness.repo";

export type ListProcedureEventsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  globalScheduleEventId?: number;
  facilityId?: string;
  serviceType?: string;
  procedureStatus?: string;
};

export async function createProcedureEvent(
  input: InsertProcedureEvent,
): Promise<ProcedureEvent> {
  const [result] = await db
    .insert(procedureEvents)
    .values(input)
    .returning();
  return result;
}

export async function updateProcedureEvent(
  id: number,
  updates: Partial<InsertProcedureEvent>,
): Promise<ProcedureEvent | undefined> {
  const [result] = await db
    .update(procedureEvents)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(procedureEvents.id, id))
    .returning();
  return result;
}

export async function getProcedureEventById(id: number): Promise<ProcedureEvent | undefined> {
  const [result] = await db
    .select()
    .from(procedureEvents)
    .where(eq(procedureEvents.id, id))
    .limit(1);
  return result;
}

export async function listProcedureEvents(
  filters: ListProcedureEventsFilters = {},
  limit = 100,
): Promise<ProcedureEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(procedureEvents.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(procedureEvents.patientScreeningId, filters.patientScreeningId));
  if (filters.globalScheduleEventId != null) conditions.push(eq(procedureEvents.globalScheduleEventId, filters.globalScheduleEventId));
  if (filters.facilityId) conditions.push(eq(procedureEvents.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(procedureEvents.serviceType, filters.serviceType));
  if (filters.procedureStatus) conditions.push(eq(procedureEvents.procedureStatus, filters.procedureStatus));

  const query = db.select().from(procedureEvents).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(procedureEvents.createdAt)).limit(safeLimit)
    : query.orderBy(desc(procedureEvents.createdAt)).limit(safeLimit);
}

export type MarkProcedureCompleteInput = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  globalScheduleEventId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType: string;
  completedByUserId?: string | null;
  note?: string | null;
  completedAt?: Date | null;
};

/** Upsert procedure event as complete (deduped by patientScreeningId + serviceType)
 *  and create/update the standard set of case_document_readiness rows. */
export async function markProcedureComplete(
  input: MarkProcedureCompleteInput,
): Promise<{ procedureEvent: ProcedureEvent; documentRows: Awaited<ReturnType<typeof upsertCaseDocumentReadinessForProcedureComplete>> }> {
  const now = input.completedAt instanceof Date && !isNaN(input.completedAt.getTime()) ? input.completedAt : new Date();

  // Deduplicate by (patientScreeningId, serviceType) when screening is linked
  let existing: ProcedureEvent | undefined;
  if (input.patientScreeningId != null) {
    const [row] = await db
      .select()
      .from(procedureEvents)
      .where(
        and(
          eq(procedureEvents.patientScreeningId, input.patientScreeningId),
          eq(procedureEvents.serviceType, input.serviceType),
        ),
      )
      .limit(1);
    existing = row;
  }

  let procedureEvent: ProcedureEvent;

  if (existing) {
    const [updated] = await db
      .update(procedureEvents)
      .set({
        procedureStatus: "complete",
        completedAt: now,
        completedByUserId: input.completedByUserId ?? undefined,
        note: input.note ?? undefined,
        updatedAt: now,
      })
      .where(eq(procedureEvents.id, existing.id))
      .returning();
    procedureEvent = updated;
  } else {
    const [created] = await db
      .insert(procedureEvents)
      .values({
        executionCaseId: input.executionCaseId ?? undefined,
        patientScreeningId: input.patientScreeningId ?? undefined,
        globalScheduleEventId: input.globalScheduleEventId ?? undefined,
        patientName: input.patientName ?? undefined,
        patientDob: input.patientDob ?? undefined,
        facilityId: input.facilityId ?? undefined,
        serviceType: input.serviceType,
        procedureStatus: "complete",
        completedByUserId: input.completedByUserId ?? undefined,
        completedAt: now,
        note: input.note ?? undefined,
      })
      .returning();
    procedureEvent = created;
  }

  const documentRows = await upsertCaseDocumentReadinessForProcedureComplete({
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
    facilityId: input.facilityId ?? null,
    serviceType: input.serviceType,
  });

  void createPendingProcedureNotes({
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    procedureEventId: procedureEvent.id,
    serviceType: input.serviceType,
  }).catch((err) => {
    console.error("[procedureEvents.repo] createPendingProcedureNotes failed:", err);
  });

  void evaluateBillingReadinessForProcedure({
    executionCaseId: input.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? null,
    procedureEventId: procedureEvent.id,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
    facilityId: input.facilityId ?? null,
    serviceType: input.serviceType,
  }).catch((err) => {
    console.error("[procedureEvents.repo] evaluateBillingReadinessForProcedure failed:", err);
  });

  return { procedureEvent, documentRows };
}
