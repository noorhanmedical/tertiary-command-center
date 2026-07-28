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
import { getProcedureEventById, getProcedureEventForExactClinicCase } from "../../repositories/procedureEvents.repo";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
// A void reconciliation is valid ONLY when the exact procedure was terminally
// INVALIDATED — never `complete` (that is an amendment, not a void).
const TERMINAL_INVALIDATION_STATUSES = new Set(["cancelled", "no_show", "unable_to_complete"]);

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
export type VoidLineageResult = {
  status:
    | "voided" | "voided_retry_recorded" | "reference_missing"
    | "no_current_note" | "deferred_retry_recorded" | "reconciliation_not_recorded"
    | "skipped_flag_off" | "zero_row_conflict" | "migration_missing";
};

export async function voidProcedureNoteLineageForCase(input: {
  clinicId: number; ancillaryCaseId: number; reason: string; actorUserId: string | null;
}): Promise<VoidLineageResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
  // Hoisted so the rollback catch can record an EXACT source-bearing retry.
  let note: typeof procedureNotes.$inferSelect | null = null;
  try {
    note = await currentCaseNote(input.clinicId, input.ancillaryCaseId);
    if (!note) return { status: "no_current_note" };
    const n = note; // const alias preserves non-null narrowing inside the tx closure.
    const now = new Date();
    const signed = n.signatureStatus === "signed";
    // Note void + (exact reference void when present) + required audit — atomic.
    const hadReference = await db.transaction(async (tx) => {
      const noteRows = await tx.update(procedureNotes)
        .set(signed ? { supersededAt: now, updatedAt: now } : { supersededAt: now, generationStatus: "voided", updatedAt: now })
        .where(and(eq(procedureNotes.id, n.id), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), isNull(procedureNotes.supersededAt)))
        .returning();
      if (noteRows.length !== 1) throw new LineageTxError("note");
      const refResult = await updateExactReferenceTx(tx as TxHandle, input.clinicId, input.ancillaryCaseId, n.id, { documentStatus: "voided", supersededAt: now });
      await appendAuditTx(tx as TxHandle, n, "procedure_note_voided", input.actorUserId, { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, source_id: n.id, reason: input.reason, was_signed: signed });
      return refResult === "updated";
    });
    if (hadReference) return { status: "voided" };
    // Note voided but NO reference existed — do NOT claim fully voided. Persist
    // an exact retry so a later-created reference is voided; surface persistence.
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: note.id, requestedAction: "void_procedure_note", sourceSystem: "procedure_note_lineage", errorCode: "void_reference_missing" });
      return { status: "voided_retry_recorded" };
    } catch { return { status: "reference_missing" }; }
  } catch (e) {
    if (e instanceof LineageTxError && e.kind === "note") return { status: "zero_row_conflict" };
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    // Whole void rolled back — record a durable retry; surface persistence
    // truthfully. Source-bearing (exact note) when the note was resolved, else a
    // valid source-LESS case-level row (never procedure_notes + null sourceId).
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: note != null ? PROCEDURE_NOTE_SOURCE_TABLE : null, sourceId: note?.id ?? null, requestedAction: "void_procedure_note", sourceSystem: "procedure_note_lineage", errorCode: (e as { code?: string })?.code ?? "void_failed" });
      return { status: "deferred_retry_recorded" };
    } catch { return { status: "reconciliation_not_recorded" }; }
  }
}

// ─── §6 — supersede the current note + create a pending amendment ───────────
export type AmendLineageResult = {
  status:
    | "amended_reference_created" | "amended_reference_retry_recorded"
    | "amendment_deferred_retry_recorded" | "reconciliation_not_recorded"
    | "no_current_note" | "skipped_flag_off"
    | "zero_row_conflict" | "migration_missing";
  newNoteId?: number;
  // TRUE only when the new note's exact reference genuinely exists.
  newReferenceCreated?: boolean;
};

export async function amendProcedureNoteLineage(input: {
  clinicId: number; ancillaryCaseId: number;
  newReportReferenceId: number | null; procedureEventId: number | null; effectiveDate: Date | null;
  actorUserId: string | null;
}): Promise<AmendLineageResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
  let created: typeof procedureNotes.$inferSelect | null = null;
  // Hoisted so the rollback catch can queue reconciliation against the EXACT
  // stale current (prior) note — never sourceTable=procedure_notes + null.
  let prior: typeof procedureNotes.$inferSelect | null = null;
  try {
    prior = await currentCaseNote(input.clinicId, input.ancillaryCaseId);
    if (!prior) return { status: "no_current_note" };
    const p = prior; // const alias preserves non-null narrowing inside the tx closure.
    const now = new Date();
    created = await db.transaction(async (tx) => {
      const supRows = await tx.update(procedureNotes)
        .set({ supersededAt: now, updatedAt: now })
        .where(and(eq(procedureNotes.id, p.id), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), isNull(procedureNotes.supersededAt)))
        .returning();
      if (supRows.length !== 1) throw new LineageTxError("note");
      await updateExactReferenceTx(tx as TxHandle, input.clinicId, input.ancillaryCaseId, p.id, { supersededAt: now, documentStatus: "superseded" });
      const [row] = await tx.insert(procedureNotes).values({
        clinicId: input.clinicId, executionCaseId: p.executionCaseId ?? null, patientScreeningId: p.patientScreeningId ?? null,
        serviceType: p.serviceType, noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature",
        ancillaryCaseId: input.ancillaryCaseId, globalPlexusPatientId: p.globalPlexusPatientId ?? null, patientClinicMembershipId: p.patientClinicMembershipId ?? null,
        procedureEventId: input.procedureEventId ?? null, reportDocumentReferenceId: input.newReportReferenceId ?? null,
        supersedesNoteId: p.id, effectiveClinicalDate: input.effectiveDate ?? null,
      }).returning();
      await appendAuditTx(tx as TxHandle, p, "procedure_note_amended", input.actorUserId, { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, prior_note_id: p.id, new_note_id: row.id, was_signed: p.signatureStatus === "signed" });
      return row;
    });
  } catch (e) {
    if (e instanceof LineageTxError && e.kind === "note") return { status: "zero_row_conflict" };
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    // A reference-conflict rollback (or any other error) — the amendment did NOT
    // commit. Record durable reconcile work; surface persistence truthfully and
    // DISTINCTLY (deferred-retry-recorded vs never-persisted).
    let recorded = false;
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: prior != null ? PROCEDURE_NOTE_SOURCE_TABLE : null, sourceId: prior?.id ?? null, requestedAction: "reconcile_procedure_note_lineage", sourceSystem: "procedure_note_lineage", errorCode: (e as { code?: string })?.code ?? "amend_failed" });
      recorded = true;
    } catch { recorded = false; }
    return { status: recorded ? "amendment_deferred_retry_recorded" : "reconciliation_not_recorded" };
  }

  // Lineage is COMMITTED. Project the new note's EXACT reference; if that fails,
  // record a durable exact link retry. `amended_*` is returned ONLY when the
  // reference exists OR the exact retry was durably persisted — never when BOTH
  // projection and retry persistence failed.
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
  if (newReferenceCreated) return { status: "amended_reference_created", newNoteId: newNote.id, newReferenceCreated: true };
  let retryRecorded = false;
  try {
    await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: newNote.id, requestedAction: "link_procedure_note", sourceSystem: "procedure_note_lineage", errorCode: "amendment_reference_deferred" });
    retryRecorded = true;
  } catch { retryRecorded = false; }
  return { status: retryRecorded ? "amended_reference_retry_recorded" : "reconciliation_not_recorded", newNoteId: newNote.id, newReferenceCreated: false };
}

// ─── §4 — exact reconciliation of a voided/superseded note's reference ───────
export type ReconcileVoidedReferenceResult = {
  status: "reconciled" | "already_reconciled" | "reference_missing" | "source_not_found" | "ownership_conflict" | "terminal_evidence_missing" | "migration_missing";
};

/**
 * Source-BEARING void recovery. Loads the EXACT named note by id (including
 * superseded/voided rows — NEVER currentCaseNote, never another note from the
 * case), validates ownership + that it is actually superseded/voided, AND
 * requires TERMINAL procedure evidence (§3): the note's exact procedure event
 * must be owned by the same clinic/case/service and be in a terminal INVALIDATION
 * status (cancelled / no_show / unable_to_complete). A note superseded merely by
 * a report AMENDMENT (procedure still `complete`) is NOT voidable by this path —
 * it returns `terminal_evidence_missing` and stays unresolved. Only then does it
 * reconcile the EXACT reference (clinic + case + procedure_notes + noteId +
 * procedure_note). Never creates a new current reference for a voided note.
 * `reference_missing` stays unresolved.
 */
export async function reconcileVoidedProcedureNoteReference(input: {
  clinicId: number; ancillaryCaseId: number; noteId: number;
}): Promise<ReconcileVoidedReferenceResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "reference_missing" };
  try {
    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, input.noteId)).limit(1);
    if (!note) return { status: "source_not_found" };
    if (note.clinicId !== input.clinicId || note.ancillaryCaseId !== input.ancillaryCaseId) return { status: "ownership_conflict" };
    if (note.noteType !== "post_procedure_note") return { status: "ownership_conflict" };
    // The note MUST actually be superseded/voided for a void reconciliation.
    if (note.supersededAt == null && note.generationStatus !== "voided") return { status: "ownership_conflict" };

    // §5 — require EXACT terminal procedure-invalidation evidence. The ownership
    // boundary FAILS CLOSED via a dedicated exact-match repository lookup: a NULL
    // clinic / case / service on the event is NOT evidence (SQL `=` against NULL
    // is UNKNOWN, so it never matches). This rejects amendment-superseded notes
    // (procedure still `complete`) and any cross-tenant / cross-case /
    // cross-service event. NO reference is mutated before this passes.
    if (note.procedureEventId == null || note.serviceType == null) return { status: "terminal_evidence_missing" };
    const pe = await getProcedureEventForExactClinicCase({
      procedureEventId: note.procedureEventId, clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId, serviceType: note.serviceType,
    });
    if (!pe) {
      // Not exactly owned — classify a genuine non-null mismatch as an ownership
      // conflict; a missing event or any NULL ownership dimension is missing
      // terminal evidence. Read-only classification (never mutates).
      const raw = await getProcedureEventById(note.procedureEventId);
      if (raw && (
        (raw.clinicId != null && raw.clinicId !== input.clinicId)
        || (raw.ancillaryCaseId != null && raw.ancillaryCaseId !== input.ancillaryCaseId)
        || (raw.serviceType != null && raw.serviceType !== note.serviceType)
      )) return { status: "ownership_conflict" };
      return { status: "terminal_evidence_missing" };
    }
    if (!TERMINAL_INVALIDATION_STATUSES.has(pe.procedureStatus)) return { status: "terminal_evidence_missing" };

    const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.clinicId, input.clinicId),
      eq(ancillaryDocumentReferences.ancillaryCaseId, input.ancillaryCaseId),
      eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
      eq(ancillaryDocumentReferences.sourceId, input.noteId),
      eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
    )).limit(1);
    if (!ref) return { status: "reference_missing" };
    if (ref.documentStatus === "voided" || ref.supersededAt != null) return { status: "already_reconciled" };

    const now = new Date();
    const rows = await db.update(ancillaryDocumentReferences)
      .set({ documentStatus: "voided", supersededAt: now, updatedAt: now })
      .where(and(
        eq(ancillaryDocumentReferences.id, ref.id),
        eq(ancillaryDocumentReferences.clinicId, input.clinicId),
        eq(ancillaryDocumentReferences.ancillaryCaseId, input.ancillaryCaseId),
        eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
        eq(ancillaryDocumentReferences.sourceId, input.noteId),
        eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
      ))
      .returning();
    if (rows.length !== 1) return { status: "reference_missing" };
    return { status: "reconciled" };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    return { status: "reference_missing" };
  }
}
