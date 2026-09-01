/**
 * Phase 5 — Order Note Lifecycle Repository.
 *
 * Manages Order Note creation (as procedure_notes rows with note_type='order_note'),
 * lifecycle transitions (Draft → Pending Signature → Signed), and addenda.
 *
 * The canonical document lifecycle lives in the `procedure_notes` table
 * (shared by both order_notes and post_procedure_notes via the note_type column).
 * The signature workflow already exists in physicianPortal/signatureWorkflow.ts.
 * This repository adds the Order-Note-specific lifecycle logic:
 *   - Creating an Order Note Draft at qualification time
 *   - Routing to clinician (setting signature_status = 'needs_signature')
 *   - Creating addenda (after screening, etc.)
 */

import { db } from "../db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { procedureNotes, type ProcedureNote } from "@shared/schema/generatedNotes";
import { noteAddenda, type NoteAddendum, type InsertNoteAddendum } from "@shared/schema/noteAddenda";

// ─── Order Note Draft Creation ────────────────────────────────────────────

export type CreateOrderNoteDraftInput = {
  clinicId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  ancillaryCaseId: number | null;
  serviceType: string;
  generatedText: string;
  generatedByAi: boolean;
  sourceData?: Record<string, unknown>;
};

/**
 * Create an Order Note Draft for a specific ancillary service episode.
 * Idempotent: if an active (non-superseded) order_note already exists for the
 * same ancillary_case_id, returns the existing row.
 */
export async function createOrderNoteDraft(
  input: CreateOrderNoteDraftInput,
): Promise<{ note: ProcedureNote; created: boolean }> {
  // Check for existing active order note for this case
  if (input.ancillaryCaseId != null) {
    const [existing] = await db
      .select()
      .from(procedureNotes)
      .where(
        and(
          eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
          eq(procedureNotes.noteType, "order_note"),
          isNull(procedureNotes.supersededAt),
        ),
      )
      .limit(1);
    if (existing) return { note: existing, created: false };
  }

  const [created] = await db
    .insert(procedureNotes)
    .values({
      clinicId: input.clinicId,
      executionCaseId: input.executionCaseId,
      patientScreeningId: input.patientScreeningId,
      ancillaryCaseId: input.ancillaryCaseId,
      serviceType: input.serviceType,
      noteType: "order_note",
      generationStatus: "generated",
      generatedText: input.generatedText,
      generatedByAi: input.generatedByAi,
      sourceData: input.sourceData ?? {},
      // Draft state: no signature status yet (not routed to clinician)
      signatureStatus: null,
    })
    .returning();

  return { note: created, created: true };
}

// ─── Order Note Lifecycle Transitions ─────────────────────────────────────

/**
 * Route an Order Note to the Clinician Portal by setting signature_status
 * to 'needs_signature'. This should be triggered when the patient is scheduled.
 *
 * Preconditions:
 * - Note must be an order_note
 * - Note must not already be signed or superseded
 * - Note must have generationStatus = 'generated' or 'approved'
 */
export async function routeOrderNoteToClinician(
  noteId: number,
): Promise<{ ok: true; note: ProcedureNote } | { ok: false; error: string }> {
  const [note] = await db
    .select()
    .from(procedureNotes)
    .where(eq(procedureNotes.id, noteId))
    .limit(1);

  if (!note) return { ok: false, error: "Note not found" };
  if (note.noteType !== "order_note") return { ok: false, error: "Not an order note" };
  if (note.supersededAt != null) return { ok: false, error: "Note is superseded" };
  if (note.signatureStatus === "signed") return { ok: false, error: "Already signed" };

  // If already routed, idempotent success
  if (note.signatureStatus === "needs_signature" || note.signatureStatus === "ready_to_sign") {
    return { ok: true, note };
  }

  const validGenStatuses = ["generated", "approved"];
  if (!validGenStatuses.includes(note.generationStatus)) {
    return { ok: false, error: `Cannot route note with generation status: ${note.generationStatus}` };
  }

  const [updated] = await db
    .update(procedureNotes)
    .set({
      signatureStatus: "needs_signature",
      updatedAt: new Date(),
    })
    .where(eq(procedureNotes.id, noteId))
    .returning();

  return { ok: true, note: updated };
}

/**
 * Get the current active Order Note for an ancillary case.
 */
export async function getActiveOrderNoteForCase(
  ancillaryCaseId: number,
): Promise<ProcedureNote | undefined> {
  const [note] = await db
    .select()
    .from(procedureNotes)
    .where(
      and(
        eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
        eq(procedureNotes.noteType, "order_note"),
        isNull(procedureNotes.supersededAt),
      ),
    )
    .limit(1);
  return note;
}

/**
 * Get all Order Notes for a patient screening (may span multiple services).
 */
export async function listOrderNotesForScreening(
  patientScreeningId: number,
): Promise<ProcedureNote[]> {
  return db
    .select()
    .from(procedureNotes)
    .where(
      and(
        eq(procedureNotes.patientScreeningId, patientScreeningId),
        eq(procedureNotes.noteType, "order_note"),
      ),
    )
    .orderBy(desc(procedureNotes.createdAt));
}

// ─── Note Addenda ─────────────────────────────────────────────────────────

/**
 * Create an addendum attached to a parent note. The parent note's signed
 * content is never mutated — the addendum is a separate traceable record.
 */
export async function createNoteAddendum(
  input: InsertNoteAddendum,
): Promise<NoteAddendum> {
  const [created] = await db
    .insert(noteAddenda)
    .values(input)
    .returning();
  return created;
}

/**
 * List all addenda for a parent note.
 */
export async function listAddendaForNote(
  parentNoteId: number,
): Promise<NoteAddendum[]> {
  return db
    .select()
    .from(noteAddenda)
    .where(eq(noteAddenda.parentNoteId, parentNoteId))
    .orderBy(desc(noteAddenda.createdAt));
}

/**
 * Get a single addendum by ID.
 */
export async function getAddendum(id: number): Promise<NoteAddendum | undefined> {
  const [result] = await db
    .select()
    .from(noteAddenda)
    .where(eq(noteAddenda.id, id))
    .limit(1);
  return result;
}

/**
 * Sign an addendum (when requires_signature = true).
 */
export async function signAddendum(
  id: number,
  signedByUserId: string,
): Promise<NoteAddendum | undefined> {
  const [result] = await db
    .update(noteAddenda)
    .set({
      signatureStatus: "signed",
      signedAt: new Date(),
      signedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(noteAddenda.id, id))
    .returning();
  return result;
}
