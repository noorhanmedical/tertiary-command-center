import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  procedureNotes,
  type ProcedureNote,
  type InsertProcedureNote,
} from "@shared/schema/generatedNotes";

export type ListProcedureNotesFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  serviceType?: string;
  noteType?: string;
  generationStatus?: string;
};

export async function createGeneratedNote(
  input: InsertProcedureNote,
): Promise<ProcedureNote> {
  const [result] = await db.insert(procedureNotes).values(input).returning();
  return result;
}

export async function updateGeneratedNote(
  id: number,
  updates: Partial<InsertProcedureNote>,
): Promise<ProcedureNote | undefined> {
  const [result] = await db
    .update(procedureNotes)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(procedureNotes.id, id))
    .returning();
  return result;
}

export async function getGeneratedNoteById(id: number): Promise<ProcedureNote | undefined> {
  const [result] = await db
    .select()
    .from(procedureNotes)
    .where(eq(procedureNotes.id, id))
    .limit(1);
  return result;
}

export async function listGeneratedNotes(
  filters: ListProcedureNotesFilters = {},
  limit = 100,
): Promise<ProcedureNote[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(procedureNotes.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(procedureNotes.patientScreeningId, filters.patientScreeningId));
  if (filters.procedureEventId != null) conditions.push(eq(procedureNotes.procedureEventId, filters.procedureEventId));
  if (filters.serviceType) conditions.push(eq(procedureNotes.serviceType, filters.serviceType));
  if (filters.noteType) conditions.push(eq(procedureNotes.noteType, filters.noteType));
  if (filters.generationStatus) conditions.push(eq(procedureNotes.generationStatus, filters.generationStatus));

  const query = db.select().from(procedureNotes).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(procedureNotes.createdAt)).limit(safeLimit)
    : query.orderBy(desc(procedureNotes.createdAt)).limit(safeLimit);
}

export type CreatePendingProcedureNotesInput = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  procedureEventId?: number | null;
  serviceType: string;
  sourceData?: Record<string, unknown>;
};

const PENDING_NOTE_TYPES: Array<"order_note" | "post_procedure_note"> = [
  "order_note",
  "post_procedure_note",
];

/** Upsert pending note request rows for order_note and post_procedure_note.
 *  Deduplicates by (patientScreeningId, serviceType, noteType). */
export async function createPendingProcedureNotes(
  input: CreatePendingProcedureNotesInput,
): Promise<ProcedureNote[]> {
  const results: ProcedureNote[] = [];

  for (const noteType of PENDING_NOTE_TYPES) {
    const conditions = [
      eq(procedureNotes.serviceType, input.serviceType),
      eq(procedureNotes.noteType, noteType),
    ];
    if (input.patientScreeningId != null) {
      conditions.push(eq(procedureNotes.patientScreeningId, input.patientScreeningId));
    }

    const [existing] = await db
      .select()
      .from(procedureNotes)
      .where(and(...conditions))
      .limit(1);

    const sharedFields = {
      executionCaseId: input.executionCaseId ?? undefined,
      procedureEventId: input.procedureEventId ?? undefined,
      serviceType: input.serviceType,
      noteType,
      generationStatus: "pending" as const,
      generatedByAi: false,
      sourceData: input.sourceData ?? {},
    };

    if (existing) {
      const [updated] = await db
        .update(procedureNotes)
        .set({ ...sharedFields, updatedAt: new Date() })
        .where(eq(procedureNotes.id, existing.id))
        .returning();
      results.push(updated);
    } else {
      const [created] = await db
        .insert(procedureNotes)
        .values({
          ...sharedFields,
          patientScreeningId: input.patientScreeningId ?? undefined,
        })
        .returning();
      results.push(created);
    }
  }

  return results;
}
