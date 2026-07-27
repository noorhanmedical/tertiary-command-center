/**
 * Phase 2F-B — canonical Procedure Note generator.
 *
 * Runs ONLY under procedureNoteGeneratorEnabled() (full Procedure Note runtime
 * + FEATURE_PROCEDURE_NOTE_GENERATOR). Never a second note table. Concurrency-
 * safe: claims exactly one pending note (id + clinic + case + pending +
 * not-superseded) via `.returning()`; a second worker never produces a
 * duplicate body. Deterministic + evidence-anchored — it NEVER invents clinical
 * findings, never copies bytes from the unsafe clinic-facing download route,
 * never uses another case's/service's/superseded report, and never uses retry
 * time as clinical time. If the report source cannot be safely resolved through
 * the tenant-scoped internal repository, generation fails with
 * `report_content_unavailable`. Never auto-signs. No note body in logs/ledger.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { ancillaryDocumentReferences, PROCEDURE_NOTE_SOURCE_TABLE, REPORT_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { procedureNoteGeneratorEnabled } from "../../lib/featureFlags";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { getProcedureEventById } from "../../repositories/procedureEvents.repo";
import { evaluateProcedureNoteEligibility } from "./procedureNoteEligibility";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
const GENERATOR_TEMPLATE_VERSION = "procedure_note_v1";

export type GenerateProcedureNoteResult = {
  status:
    | "skipped_flag_off" | "note_not_found" | "not_pending" | "already_claimed"
    | "cross_clinic_denied" | "not_yet_eligible" | "report_content_unavailable"
    | "generated" | "failed" | "migration_missing";
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
      await failNote(input.noteId, input.clinicId, "report_content_unavailable");
      return { status: "report_content_unavailable" };
    }

    // Deterministic, evidence-anchored body — NO invented findings, timeless.
    const body = renderBody({ serviceType: note.serviceType, completedAt: pe.completedAt ?? null, reportReferenceId: report.referenceId, reportSourceId: report.sourceId });
    const sourceData = {
      template: GENERATOR_TEMPLATE_VERSION,
      procedure_event_id: pe.id, procedure_completed_at: pe.completedAt?.toISOString() ?? null,
      report_document_reference_id: report.referenceId, report_source_table: REPORT_SOURCE_TABLE, report_source_id: report.sourceId,
      ancillary_case_id: input.ancillaryCaseId, service_type: note.serviceType,
    };
    const [done] = await db.update(procedureNotes)
      .set({ generationStatus: "generated", generatedText: body, generatedByAi: false, sourceData: sourceData as never, errorMessage: null, updatedAt: new Date() })
      .where(and(eq(procedureNotes.id, input.noteId), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.generationStatus, "generating")))
      .returning();
    if (!done) { await failNote(input.noteId, input.clinicId, "generation_commit_conflict"); return { status: "failed" }; }

    // Mirror generated status onto the exact reference (truthful; body never stored there).
    await db.update(ancillaryDocumentReferences)
      .set({ documentStatus: "pending_signature", updatedAt: new Date() })
      .where(and(eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, input.noteId), eq(ancillaryDocumentReferences.documentKind, "procedure_note"), eq(ancillaryDocumentReferences.clinicId, input.clinicId)));

    return { status: "generated", procedureNoteId: input.noteId };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    try { await failNote(input.noteId, input.clinicId, (e as { code?: string })?.code ?? "generation_failed"); } catch { /* ignore */ }
    return { status: "failed" };
  }
}

/** PHI-free failure stamp (error CODE only, never note body). */
async function failNote(noteId: number, clinicId: number, code: string): Promise<void> {
  await db.update(procedureNotes)
    .set({ generationStatus: "failed", errorMessage: code, updatedAt: new Date() })
    .where(and(eq(procedureNotes.id, noteId), eq(procedureNotes.clinicId, clinicId), eq(procedureNotes.generationStatus, "generating")));
}

/** Load the exact report source through the internal readiness repository only. */
async function loadReportEvidence(clinicId: number, ancillaryCaseId: number, referenceId: number | null): Promise<{ referenceId: number; sourceId: number } | null> {
  if (referenceId == null) return null;
  const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.id, referenceId), eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId), eq(ancillaryDocumentReferences.documentKind, "report"),
    isNull(ancillaryDocumentReferences.supersededAt),
  )).limit(1);
  if (!ref) return null;
  // Verify the canonical readiness source is resolvable (tenant-scoped) — never
  // the clinic-facing download route, never bytes.
  const [src] = await db.select().from(caseDocumentReadiness).where(eq(caseDocumentReadiness.id, ref.sourceId)).limit(1);
  if (!src || (src.clinicId != null && src.clinicId !== clinicId)) return null;
  return { referenceId: ref.id, sourceId: ref.sourceId };
}

/** Deterministic, timeless body from canonical evidence only (no findings). */
function renderBody(args: { serviceType: string; completedAt: Date | null; reportReferenceId: number; reportSourceId: number }): string {
  const when = args.completedAt ? args.completedAt.toISOString().slice(0, 10) : "the recorded procedure date";
  return [
    `Post-Procedure Note — ${args.serviceType}.`,
    `The ${args.serviceType} procedure was completed on ${when}.`,
    `A current diagnostic report is on file (canonical report reference #${args.reportReferenceId}).`,
    `Clinical findings are documented in the associated report; this note certifies procedure completion and report association for signature.`,
  ].join("\n");
}
