/**
 * Phase 2F-B — Procedure Note lineage: report-replacement amendments (§6) and
 * procedure-invalidation voids (§7).
 *
 * Invariants: never two current notes for one case; a signed note's body /
 * signer / signedAt is NEVER altered (invalidation/amendment is an audited
 * supersession only); a generated clinical body is never silently rewritten
 * against new evidence — it is superseded and a new pending note is created;
 * voids retain the generated body for audit but mark it not-current; every
 * multi-row change is atomic and affected-row checked. Full runtime gate.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { ancillaryDocumentReferences, PROCEDURE_NOTE_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { procedureNoteRuntimeEnabled } from "../../lib/featureFlags";
import { recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";

const AUDIT_SENTINEL_NAME = "[ancillary_document_audit]";
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

async function appendAudit(note: typeof procedureNotes.$inferSelect, eventType: string, actorUserId: string | null, metadata: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME, patientDob: null,
      patientScreeningId: note.patientScreeningId ?? null, executionCaseId: note.executionCaseId ?? null,
      eventType, eventSource: "procedure_note_lineage", actorUserId,
      summary: `Procedure Note ${eventType} (${note.serviceType})`, metadata,
    });
  } catch { /* audit best-effort */ }
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
      // Unsigned → generationStatus='voided' + supersededAt. Signed → supersede
      // only (body/signer/signedAt immutable).
      const noteRows = await tx.update(procedureNotes)
        .set(signed ? { supersededAt: now, updatedAt: now } : { supersededAt: now, generationStatus: "voided", updatedAt: now })
        .where(and(eq(procedureNotes.id, note.id), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), isNull(procedureNotes.supersededAt)))
        .returning();
      if (noteRows.length !== 1) return { status: "zero_row_conflict" as const };
      // Void the exact unified reference.
      await tx.update(ancillaryDocumentReferences)
        .set({ documentStatus: "voided", supersededAt: now, updatedAt: now })
        .where(and(eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, note.id), eq(ancillaryDocumentReferences.documentKind, "procedure_note"), eq(ancillaryDocumentReferences.clinicId, input.clinicId)));
      await appendAudit(note, "procedure_note_voided", input.actorUserId, { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, source_id: note.id, reason: input.reason, was_signed: signed });
      return { status: "voided" as const };
    });
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    // Record a durable, PHI-free retry so the void is reconciled later.
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, requestedAction: "void_procedure_note", sourceSystem: "procedure_note_lineage", errorCode: (e as { code?: string })?.code ?? "void_failed" });
    } catch { /* ledger guard */ }
    return { status: "deferred" };
  }
}

// ─── §6 — supersede the current note + create a pending amendment ───────────
export type AmendLineageResult = { status: "amended" | "no_current_note" | "skipped_flag_off" | "zero_row_conflict" | "migration_missing" | "deferred"; newNoteId?: number };

/**
 * Report replacement / signed-note amendment: supersede the current note and
 * create a NEW pending post_procedure_note (supersedesNoteId = prior) carrying
 * the exact new report/procedure evidence. Never rewrites the prior body,
 * never alters a signed body/signer/signedAt, never leaves two current notes.
 */
export async function amendProcedureNoteLineage(input: {
  clinicId: number; ancillaryCaseId: number;
  newReportReferenceId: number | null; procedureEventId: number | null; effectiveDate: Date | null;
  actorUserId: string | null;
}): Promise<AmendLineageResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const prior = await currentCaseNote(input.clinicId, input.ancillaryCaseId);
    if (!prior) return { status: "no_current_note" };
    const now = new Date();
    return await db.transaction(async (tx) => {
      const supRows = await tx.update(procedureNotes)
        .set({ supersededAt: now, updatedAt: now })
        .where(and(eq(procedureNotes.id, prior.id), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), isNull(procedureNotes.supersededAt)))
        .returning();
      if (supRows.length !== 1) return { status: "zero_row_conflict" as const };
      // Supersede the prior reference (no longer current).
      await tx.update(ancillaryDocumentReferences)
        .set({ supersededAt: now, documentStatus: "superseded", updatedAt: now })
        .where(and(eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, prior.id), eq(ancillaryDocumentReferences.documentKind, "procedure_note"), eq(ancillaryDocumentReferences.clinicId, input.clinicId)));
      const [created] = await tx.insert(procedureNotes).values({
        clinicId: input.clinicId, executionCaseId: prior.executionCaseId ?? null, patientScreeningId: prior.patientScreeningId ?? null,
        serviceType: prior.serviceType, noteType: "post_procedure_note", generationStatus: "pending", signatureStatus: "needs_signature",
        ancillaryCaseId: input.ancillaryCaseId, globalPlexusPatientId: prior.globalPlexusPatientId ?? null, patientClinicMembershipId: prior.patientClinicMembershipId ?? null,
        procedureEventId: input.procedureEventId ?? null, reportDocumentReferenceId: input.newReportReferenceId ?? null,
        supersedesNoteId: prior.id, effectiveClinicalDate: input.effectiveDate ?? null,
      }).returning();
      await appendAudit(prior, "procedure_note_amended", input.actorUserId, { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, prior_note_id: prior.id, new_note_id: created.id, was_signed: prior.signatureStatus === "signed" });
      return { status: "amended" as const, newNoteId: created.id };
    });
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    try {
      await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, requestedAction: "reconcile_procedure_note_lineage", sourceSystem: "procedure_note_lineage", errorCode: (e as { code?: string })?.code ?? "amend_failed" });
    } catch { /* ledger guard */ }
    return { status: "deferred" };
  }
}
