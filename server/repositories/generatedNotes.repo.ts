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

/** Structured error thrown when a general update targets a SIGNED note. */
export class SignedNoteImmutableError extends Error {
  code = "SIGNED_NOTE_IMMUTABLE" as const;
  constructor() {
    super("signed_note_immutable: a signed note cannot be altered through the general update path");
    this.name = "SignedNoteImmutableError";
  }
}

/**
 * General note update. The `updates` type (Partial<InsertProcedureNote>)
 * structurally CANNOT carry signatureStatus/signedAt/signedByUserId — those
 * are omitted from the insert schema and only writable via the dedicated
 * clinic-scoped signing commands below.
 *
 * A SIGNED note is FULLY immutable through this path: any non-empty update
 * to a row with signatureStatus = 'signed' is rejected with a structured
 * SIGNED_NOTE_IMMUTABLE error (never silently ignored). Only the dedicated,
 * audited signing/return transitions may change a note after signing.
 */
export async function updateGeneratedNote(
  id: number,
  updates: Partial<InsertProcedureNote>,
): Promise<ProcedureNote | undefined> {
  const hasUpdate = Object.keys(updates).length > 0;
  if (hasUpdate) {
    const [existing] = await db
      .select()
      .from(procedureNotes)
      .where(eq(procedureNotes.id, id))
      .limit(1);
    if (existing?.signatureStatus === "signed") {
      // Reject EVERY field: content, linkage, serviceType/noteType,
      // generationStatus, clinicId, identity/evidence/supersession,
      // returnReason — the general path may not touch a signed note at all.
      throw new SignedNoteImmutableError();
    }
  }
  const [result] = await db
    .update(procedureNotes)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(procedureNotes.id, id))
    .returning();
  return result;
}

// ─── Dedicated, server-owned, clinic-scoped signing commands ─────────
// These are the ONLY paths that write signatureStatus/signedAt/
// signedByUserId/returnReason. They carry NO client-supplied signer or
// timestamp: signedAt is stamped from server time here, and signedByUserId
// is the authenticated session user id passed by the route/service layer.
// Every write is scoped by BOTH the note id AND the caller's clinicId, so a
// clinician can never sign or return a note belonging to another clinic —
// and an absent/other-clinic id returns `undefined` (the same not-found
// signal), disclosing no cross-tenant existence.

export type SignProcedureNoteCommand = {
  id: number;
  clinicId: number;
  /** Authenticated session user id — never a request-body value. */
  signedByUserId: string | null;
};

export type ReturnProcedureNoteCommand = {
  id: number;
  clinicId: number;
  reason: string;
};

/**
 * Sign a note. Server-owned: signedAt = server time, signer = authenticated
 * session user, generationStatus promoted to 'approved' (existing billing
 * readiness behavior). Scoped by (id, clinicId).
 */
export async function signProcedureNoteRow(
  cmd: SignProcedureNoteCommand,
): Promise<ProcedureNote | undefined> {
  const [result] = await db
    .update(procedureNotes)
    .set({
      signatureStatus: "signed",
      signedAt: new Date(),
      signedByUserId: cmd.signedByUserId,
      generationStatus: "approved",
      updatedAt: new Date(),
    })
    .where(and(eq(procedureNotes.id, cmd.id), eq(procedureNotes.clinicId, cmd.clinicId)))
    .returning();
  return result;
}

/**
 * Return a note for correction. Never fabricates signing data (no signedAt,
 * no signer). Scoped by (id, clinicId).
 */
export async function returnProcedureNoteRow(
  cmd: ReturnProcedureNoteCommand,
): Promise<ProcedureNote | undefined> {
  const [result] = await db
    .update(procedureNotes)
    .set({
      signatureStatus: "returned_for_correction",
      returnReason: cmd.reason,
      updatedAt: new Date(),
    })
    .where(and(eq(procedureNotes.id, cmd.id), eq(procedureNotes.clinicId, cmd.clinicId)))
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
