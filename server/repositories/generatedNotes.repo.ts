import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  procedureNotes,
  type ProcedureNote,
  type InsertProcedureNote,
  type ProcedureNoteSignatureUpdate,
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

// Content fields that a signed note must never have overwritten through
// the GENERAL update path. Signature transitions are NOT in this set — they
// have their own dedicated, session-authenticated path below.
const SIGNED_NOTE_IMMUTABLE_CONTENT_FIELDS: Array<keyof InsertProcedureNote> = [
  "generatedText",
  "generatedByAi",
  "sourceData",
  "serviceType",
  "noteType",
  "errorMessage",
];

/**
 * General note update. The `updates` type (Partial<InsertProcedureNote>)
 * structurally CANNOT carry signatureStatus/signedAt/signedByUserId — those
 * are omitted from the insert schema and only writable via
 * applyProcedureNoteSignatureUpdate. Additionally, once a note is signed its
 * clinical content is immutable through this path.
 */
export async function updateGeneratedNote(
  id: number,
  updates: Partial<InsertProcedureNote>,
): Promise<ProcedureNote | undefined> {
  const touchesContent = SIGNED_NOTE_IMMUTABLE_CONTENT_FIELDS.some((f) => f in updates);
  if (touchesContent) {
    const [existing] = await db
      .select()
      .from(procedureNotes)
      .where(eq(procedureNotes.id, id))
      .limit(1);
    if (existing?.signatureStatus === "signed") {
      const err = new Error(
        "signed_note_content_immutable: a signed note's content cannot be overwritten through a general update",
      ) as Error & { code?: string };
      err.code = "SIGNED_NOTE_CONTENT_IMMUTABLE";
      throw err;
    }
  }
  const [result] = await db
    .update(procedureNotes)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(procedureNotes.id, id))
    .returning();
  return result;
}

/**
 * Dedicated, server-only signature transition. This is the ONLY path that
 * writes signatureStatus/signedAt/signedByUserId/returnReason.
 *
 * - The signer id is taken from `update.signedByUserId`, which callers
 *   MUST source from the authenticated session — never a client body.
 * - When transitioning to `signed`, signedAt is stamped from SERVER time
 *   (any caller-supplied value is a server-computed `new Date()`), and the
 *   note is promoted to `approved` so downstream billing readiness rules
 *   treat it as a passing document.
 * - Non-signing transitions never touch signedAt/signedByUserId.
 */
export async function applyProcedureNoteSignatureUpdate(
  id: number,
  update: ProcedureNoteSignatureUpdate,
): Promise<ProcedureNote | undefined> {
  const set: Record<string, unknown> = {
    signatureStatus: update.signatureStatus,
    updatedAt: new Date(),
  };
  if (update.signatureStatus === "signed") {
    // Server-owned: signer identity + signing instant are authoritative.
    set.signedAt = update.signedAt ?? new Date();
    set.signedByUserId = update.signedByUserId ?? null;
    set.generationStatus = "approved";
  }
  if (update.signatureStatus === "returned_for_correction") {
    set.returnReason = update.returnReason ?? null;
  }
  const [result] = await db
    .update(procedureNotes)
    .set(set)
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
