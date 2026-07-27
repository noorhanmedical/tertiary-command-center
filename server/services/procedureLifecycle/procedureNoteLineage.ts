/**
 * Phase 2F-B — Procedure Note lineage: report-replacement amendments (§6) and
 * procedure-invalidation voids (§7), ATOMIC (§5).
 *
 * Invariants: never two current notes for one case; a signed note's body /
 * signer / signedAt is NEVER altered (invalidation/amendment is an audited
 * supersession only); a generated body is superseded, never silently rewritten;
 * ALL required note + reference + audit writes use the SAME transaction handle;
 * each required write is affected-row checked with full ownership predicates;
 * any conflict or required-audit failure rolls back the whole operation
 * (`amended`/`voided` is NEVER returned on partial success); a missing/failed
 * reference becomes a truthful exact reconciliation retry. Full runtime gate.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { ancillaryDocumentReferences, PROCEDURE_NOTE_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { procedureNoteRuntimeEnabled } from "../../lib/featureFlags";
import { createReference, recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

// A minimal tx surface (db or a transaction handle) for the shared writers.
type TxHandle = Pick<typeof db, "select" | "update" | "insert">;

async function appendAuditTx(tx: TxHandle, note: typeof procedureNotes.$inferSelect, eventType: string, actorUserId: string | null, metadata: Record<string, unknown>): Promise<void> {
  // Required audit — inside the transaction; a failure rolls the operation back.
  await tx.insert(patientJourneyEvents).values({
    patientName: "[ancillary_document_audit]", patientDob: null,
    patientScreeningId: note.patientScreeningId ?? null, executionCaseId: note.executionCaseId ?? null,
    eventType, eventSource: "procedure_note_lineage", actorUserId,
    summary: `Procedure Note ${eventType} (${note.serviceType})`, metadata,
  });
}

async function currentCaseNote(clinicId: number, ancillaryCaseId: number): Promise<typeof procedureNotes.$inferSelect | null> {
  const [row] = await db.select().from(procedureNotes).where(and(
    eq(procedureNotes.clinicId, clinicId),
    eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
    eq(procedureNotes.noteType, "post_procedure_note"),
    isNull(procedureNotes.supersededAt),
  )).limit(1);
  return row ?? null;
}

/** Update the exact current reference within the tx (full ownership predicates)
 *  when one exists; require exactly one affected row. No reference → false. */
async function updateExactReferenceTx(tx: TxHandle, clinicId: number, ancillaryCaseId: number, noteId: number, patch: Record<string, unknown>): Promise<"updated" | "no_reference"> {
  const [ref] = await tx.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
    eq(ancillaryDocumentReferences.sourceId, noteId),
    eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
  )).limit(1);
  if (!ref) return "no_reference";
  const rows = await tx.update(ancillaryDocumentReferences).set({ ...patch, updatedAt: new Date() }).where(and(
    eq(ancillaryDocumentReferences.id, ref.id),
    eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId),
    eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
    eq(ancillaryDocumentReferences.sourceId, noteId),
    eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
  )).returning();
  if (rows.length !== 1) throw new LineageTxError("reference");
  return "updated";
}

class LineageTxError extends Error { constructor(public kind: "note" | "reference") { super(kind); } }

// ─── §7 — void the current note lineage when the procedure becomes invalid ──
export type VoidLineageResult = { status: "voided" | "no_current_note" | "skipped_flag_off" | "zero_row_conflict" | "migration_missing" | "deferred" };

export async function voidProcedureNoteLineageForCase(input: {
  clinicId: number; ancillaryCaseId: number; reason: string; actorUserId: string | null;
}): Promise<VoidLineageResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const note = await currentCaseNote(input.clinicId, input.ancillaryCaseId);
    if (!note) return { status: "no_current_note" };
    const now = new Date();
    const signed = note.signatureStatus === "signed";
    return await db.transaction(async (tx) => {
      const noteRows = await tx.update(procedureNotes)
        .set(signed ? { supersededAt: now, updatedAt: now } : { supersededAt: now, generationStatus: "voided", updatedAt: now })
        .where(and(eq(procedureNotes.id, note.id), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), isNull(procedureNotes.supersededAt)))
        .returning();
      if (noteRows.length !== 1) throw new LineageTxError("note");
      await updateExactReferenceTx(tx as TxHandle, input.clinicId, input.ancillaryCaseId, note.id, { documentStatus: "voided", supersededAt: now });
      await appendAuditTx(tx as TxHandle, note, "procedure_note_voided", input.actorUserId, { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, source_id: note.id, reason: input.reason, was_signed: signed });
      return { status: "voided" as const };
    });
  } catch (e) {
    if (e instanceof LineageTxError && e.kind === "note") return { status: "zero_row_conflict" };
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, requestedAction: "void_procedure_note", sourceSystem: "procedure_note_lineage", errorCode: (e as { code?: string })?.code ?? "void_failed" });
    } catch { /* ledger guard */ }
    return { status: "deferred" };
  }
}

// ─── §6 — supersede the current note + create a pending amendment ───────────
export type AmendLineageResult = {
  status: "amended" | "no_current_note" | "skipped_flag_off" | "zero_row_conflict" | "migration_missing" | "deferred";
  newNoteId?: number;
  // Whether the new note's exact reference was created (else a durable exact
  // link retry was recorded — never overstated).
  newReferenceCreated?: boolean;
};

export async function amendProcedureNoteLineage(input: {
  clinicId: number; ancillaryCaseId: number;
  newReportReferenceId: number | null; procedureEventId: number | null; effectiveDate: Date | null;
  actorUserId: string | null;
}): Promise<AmendLineageResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
  let created: typeof procedureNotes.$inferSelect | null = null;
  try {
    const prior = await currentCaseNote(input.clinicId, input.ancillaryCaseId);
    if (!prior) return { status: "no_current_note" };
    const now = new Date();
    created = await db.transaction(async (tx) => {
      const supRows = await tx.update(procedureNotes)
        .set({ supersededAt: now, updatedAt: now })
        .where(and(eq(procedureNotes.id, prior.id), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), isNull(procedureNotes.supersededAt)))
        .returning();
      if (supRows.length !== 1) throw new LineageTxError("note");
      await updateExactReferenceTx(tx as TxHandle, input.clinicId, input.ancillaryCaseId, prior.id, { supersededAt: now, documentStatus: "superseded" });
      const [row] = await tx.insert(procedureNotes).values({
        clinicId: input.clinicId, executionCaseId: prior.executionCaseId ?? null, patientScreeningId: prior.patientScreeningId ?? null,
        serviceType: prior.serviceType, noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature",
        ancillaryCaseId: input.ancillaryCaseId, globalPlexusPatientId: prior.globalPlexusPatientId ?? null, patientClinicMembershipId: prior.patientClinicMembershipId ?? null,
        procedureEventId: input.procedureEventId ?? null, reportDocumentReferenceId: input.newReportReferenceId ?? null,
        supersedesNoteId: prior.id, effectiveClinicalDate: input.effectiveDate ?? null,
      }).returning();
      await appendAuditTx(tx as TxHandle, prior, "procedure_note_amended", input.actorUserId, { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, prior_note_id: prior.id, new_note_id: row.id, was_signed: prior.signatureStatus === "signed" });
      return row;
    });
  } catch (e) {
    if (e instanceof LineageTxError && e.kind === "note") return { status: "zero_row_conflict" };
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, requestedAction: "reconcile_procedure_note_lineage", sourceSystem: "procedure_note_lineage", errorCode: (e as { code?: string })?.code ?? "amend_failed" });
    } catch { /* ledger guard */ }
    return { status: "deferred" };
  }

  // Lineage is committed. Create the new note's EXACT reference, or record a
  // durable exact link retry (never a silent gap; never two current notes).
  const newNote = created!;
  let newReferenceCreated = false;
  try {
    const documentStatus = newNote.signatureStatus === "signed" ? "signed" : "pending_signature";
    const ref = await createReference({
      clinicId: input.clinicId, globalPlexusPatientId: newNote.globalPlexusPatientId ?? null, patientClinicMembershipId: newNote.patientClinicMembershipId ?? null,
      patientScreeningId: newNote.patientScreeningId ?? null, executionCaseId: newNote.executionCaseId ?? null, ancillaryCaseId: input.ancillaryCaseId,
      documentKind: "procedure_note", sourceSystem: "procedure_note_lineage", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: newNote.id,
      serviceType: newNote.serviceType, documentStatus, effectiveClinicalDate: newNote.effectiveClinicalDate ?? null, signedAt: newNote.signedAt ?? null, actualCreatedAt: newNote.createdAt ?? null,
      metadata: { procedure_event_id: newNote.procedureEventId ?? null, report_document_reference_id: newNote.reportDocumentReferenceId ?? null },
    });
    newReferenceCreated = ref.outcome === "created" || ref.outcome === "reused_exact_source_unchanged" || ref.outcome === "reused_exact_source_updated";
  } catch { /* fall through to durable retry */ }
  if (!newReferenceCreated) {
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: newNote.id, requestedAction: "link_procedure_note", sourceSystem: "procedure_note_lineage", errorCode: "amendment_reference_deferred" });
    } catch { /* ledger guard */ }
  }
  return { status: "amended", newNoteId: newNote.id, newReferenceCreated };
}
