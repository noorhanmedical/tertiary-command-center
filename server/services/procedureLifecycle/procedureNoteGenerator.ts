/**
 * Phase 2F-B — canonical Procedure Note generator (EVIDENCE-ONLY procedure
 * completion CERTIFICATION — option B).
 *
 * The generated document is explicitly a NON-FINDINGS procedural completion
 * certification: it certifies that the exact ancillary procedure completed and
 * that a current canonical report is associated, and points the signer to that
 * report for clinical findings. It is NOT rendered from report content and
 * makes NO clinical findings claims — nothing is fabricated.
 *
 * Runs ONLY under procedureNoteGeneratorEnabled() (full Procedure Note runtime
 * + FEATURE_PROCEDURE_NOTE_GENERATOR). Never a second note table. Concurrency-
 * safe: claims exactly one pending note (id + clinic + case + pending +
 * not-superseded) via `.returning()`; a second worker never produces a
 * duplicate. Uses only EXACT tenant/case/service/current/non-superseded report
 * + procedure evidence resolved through internal repositories (never the unsafe
 * clinic-facing download route, never bytes); if the exact report source cannot
 * be resolved, it fails with `report_content_unavailable` (never a generic
 * success). Never uses retry time as clinical time. Never auto-signs. No
 * document body appears in logs or retry rows. A failure records/preserves an
 * exact generate_procedure_note retry.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { ancillaryDocumentReferences, PROCEDURE_NOTE_SOURCE_TABLE, REPORT_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { procedureNoteGeneratorEnabled } from "../../lib/featureFlags";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { getProcedureEventById } from "../../repositories/procedureEvents.repo";
import { recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";
import { evaluateProcedureNoteEligibility } from "./procedureNoteEligibility";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
const GENERATOR_TEMPLATE_VERSION = "procedure_completion_certification_v1";

export type GenerateProcedureNoteResult = {
  status:
    | "skipped_flag_off" | "note_not_found" | "not_pending" | "already_claimed"
    | "cross_clinic_denied" | "not_yet_eligible"
    | "report_content_unavailable_retry_recorded" | "report_content_unavailable_retry_not_recorded"
    | "generated" | "failed_retry_recorded" | "failed_retry_not_recorded" | "migration_missing";
  procedureNoteId?: number;
};

export async function generateProcedureNote(input: {
  clinicId: number; ancillaryCaseId: number; noteId: number; actorUserId?: string | null;
}): Promise<GenerateProcedureNoteResult> {
  if (!procedureNoteGeneratorEnabled()) return { status: "skipped_flag_off" };
  try {
    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, input.noteId)).limit(1);
    if (!note) return { status: "note_not_found" };
    if (note.clinicId !== input.clinicId || note.ancillaryCaseId !== input.ancillaryCaseId) return { status: "cross_clinic_denied" };
    if (note.noteType !== "post_procedure_note" || note.supersededAt != null) return { status: "not_pending" };
    if (note.signatureStatus === "signed") return { status: "not_pending" };

    // Two-condition eligibility must hold with EXACT evidence.
    const elig = await evaluateProcedureNoteEligibility({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
    if (!elig.eligible) return { status: "not_yet_eligible" };

    // Atomically CLAIM the pending note → generating (second worker gets 0 rows).
    const claimed = await db.update(procedureNotes)
      .set({ generationStatus: "generating", updatedAt: new Date() })
      .where(and(
        eq(procedureNotes.id, input.noteId), eq(procedureNotes.clinicId, input.clinicId),
        eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
        eq(procedureNotes.noteType, "post_procedure_note"),
        eq(procedureNotes.generationStatus, "pending"),
        isNull(procedureNotes.supersededAt),
      ))
      .returning();
    if (claimed.length !== 1) return { status: "already_claimed" };

    // Resolve the EXACT report + procedure evidence through internal repos only.
    const acase = await getAncillaryCaseById(input.ancillaryCaseId);
    const pe = elig.qualifyingProcedureEventId != null ? await getProcedureEventById(elig.qualifyingProcedureEventId) : undefined;
    const report = await loadReportEvidence(input.clinicId, input.ancillaryCaseId, elig.qualifyingReportReferenceId ?? null);
    if (!acase || !pe || !report) {
      const recorded = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, "report_content_unavailable");
      return { status: recorded ? "report_content_unavailable_retry_recorded" : "report_content_unavailable_retry_not_recorded" };
    }

    // Deterministic, evidence-anchored CERTIFICATION — NO invented findings, timeless.
    const body = renderBody({ serviceType: note.serviceType, completedAt: pe.completedAt ?? null, reportReferenceId: report.referenceId, reportSourceId: report.sourceId });
    const sourceData = {
      document_kind: "procedure_completion_certification",
      template: GENERATOR_TEMPLATE_VERSION,
      procedure_event_id: pe.id, procedure_completed_at: pe.completedAt?.toISOString() ?? null,
      report_document_reference_id: report.referenceId, report_source_table: REPORT_SOURCE_TABLE, report_source_id: report.sourceId,
      report_document_status: report.documentStatus,
      ancillary_case_id: input.ancillaryCaseId, service_type: note.serviceType,
    };
    const [done] = await db.update(procedureNotes)
      .set({ generationStatus: "generated", generatedText: body, generatedByAi: false, sourceData: sourceData as never, errorMessage: null, updatedAt: new Date() })
      .where(and(eq(procedureNotes.id, input.noteId), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.generationStatus, "generating")))
      .returning();
    if (!done) { const rec = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, "generation_commit_conflict"); return { status: rec ? "failed_retry_recorded" : "failed_retry_not_recorded" }; }

    // Mirror generated status onto the exact reference (truthful; body never stored there).
    await db.update(ancillaryDocumentReferences)
      .set({ documentStatus: "pending_signature", updatedAt: new Date() })
      .where(and(eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, input.noteId), eq(ancillaryDocumentReferences.documentKind, "procedure_note"), eq(ancillaryDocumentReferences.clinicId, input.clinicId)));

    return { status: "generated", procedureNoteId: input.noteId };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    let recorded = false;
    try { recorded = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, (e as { code?: string })?.code ?? "generation_failed"); } catch { recorded = false; }
    return { status: recorded ? "failed_retry_recorded" : "failed_retry_not_recorded" };
  }
}

/**
 * PHI-free failure stamp (error CODE only, never note body / report content) +
 * a durable exact generate_procedure_note retry (exact clinic + case + source).
 * Returns whether the ledger row was actually persisted — the note stays
 * truthfully `failed` even when persistence fails; durability is never
 * overstated (§2/§7).
 */
async function failNote(noteId: number, clinicId: number, ancillaryCaseId: number, code: string): Promise<boolean> {
  await db.update(procedureNotes)
    .set({ generationStatus: "failed", errorMessage: code, updatedAt: new Date() })
    .where(and(eq(procedureNotes.id, noteId), eq(procedureNotes.clinicId, clinicId), eq(procedureNotes.generationStatus, "generating")));
  try {
    await recordAncillaryDocumentFailure({ clinicId, ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: noteId, requestedAction: "generate_procedure_note", sourceSystem: "procedure_note_generator", errorCode: code });
    return true;
  } catch { return false; }
}

/** Resolve the exact CURRENT report source through internal repositories only —
 *  a readiness row ALONE is insufficient; the reference must be the exact
 *  tenant/case/report kind, non-superseded, and its readiness source resolvable. */
async function loadReportEvidence(clinicId: number, ancillaryCaseId: number, referenceId: number | null): Promise<{ referenceId: number; sourceId: number; documentStatus: string } | null> {
  if (referenceId == null) return null;
  const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.id, referenceId), eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId), eq(ancillaryDocumentReferences.documentKind, "report"),
    isNull(ancillaryDocumentReferences.supersededAt),
  )).limit(1);
  if (!ref) return null;
  // The canonical readiness source must be resolvable + tenant-consistent + in an
  // acceptable current status (never the clinic-facing download route, never bytes).
  const [src] = await db.select().from(caseDocumentReadiness).where(eq(caseDocumentReadiness.id, ref.sourceId)).limit(1);
  if (!src || (src.clinicId != null && src.clinicId !== clinicId)) return null;
  if (!ACCEPTABLE_REPORT_SOURCE_STATUSES.has(src.documentStatus)) return null;
  return { referenceId: ref.id, sourceId: ref.sourceId, documentStatus: src.documentStatus };
}

const ACCEPTABLE_REPORT_SOURCE_STATUSES = new Set(["uploaded", "generated", "approved", "completed", "signed"]);

/** Deterministic, timeless procedure-completion CERTIFICATION — evidence-only,
 *  explicitly NOT rendered from report content and asserting NO clinical findings. */
function renderBody(args: { serviceType: string; completedAt: Date | null; reportReferenceId: number; reportSourceId: number }): string {
  const when = args.completedAt ? args.completedAt.toISOString().slice(0, 10) : "the recorded procedure date";
  return [
    `Procedure Completion Certification — ${args.serviceType}.`,
    `This certification records that the ${args.serviceType} procedure was completed on ${when} and that a current canonical diagnostic report is associated (report reference #${args.reportReferenceId}).`,
    `This is an evidence-based completion certification only — it does not reproduce or interpret report content. Clinical findings are documented exclusively in the associated report.`,
    `Prepared for physician review and signature.`,
  ].join("\n");
}
