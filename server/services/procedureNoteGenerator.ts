/**
 * Phase 8 — Procedure Note Generator.
 *
 * Triggered when a test report is uploaded (documentType = "report" completed
 * via POST /api/case-document-readiness/complete). Generates a Procedure Note
 * that incorporates the entire clinical chain:
 *   - Signed Order Note (original justification)
 *   - Screening Addendum (additional clinical findings)
 *   - Procedure/test details
 *   - Uploaded report reference
 *
 * Key rules:
 * - Idempotent: same (ancillaryCaseId, reportReadinessId) never creates duplicates
 * - Failure never rolls back a valid report upload
 * - Generated note enters the clinician signature worklist (signature_status = 'needs_signature')
 * - Uses existing procedure_notes table (note_type = 'post_procedure_note')
 * - Does NOT auto-sign — clinician must review and sign
 */

import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { procedureNotes, type ProcedureNote } from "@shared/schema/generatedNotes";
import { noteAddenda } from "@shared/schema/noteAddenda";
import { getActiveOrderNoteForCase, listAddendaForNote } from "../repositories/orderNoteLifecycle.repo";

export type ProcedureNoteGenerationInput = {
  /** The ancillary case this report belongs to. */
  ancillaryCaseId: number;
  /** The execution case ID. */
  executionCaseId: number;
  /** The patient_screening_id. */
  patientScreeningId: number | null;
  /** Clinic ID. */
  clinicId: number | null;
  /** The service type. */
  serviceType: string;
  /** The case_document_readiness row ID for the report. */
  reportReadinessId: number;
  /** Patient name for the note. */
  patientName: string;
  /** Patient DOB. */
  patientDob: string | null;
  /** Facility. */
  facilityId: string | null;
  /** Report metadata from the completion request. */
  reportMetadata: Record<string, unknown>;
  /** Actor user ID. */
  actorUserId: string | null;
};

export type ProcedureNoteGenerationResult =
  | { status: "generated"; note: ProcedureNote }
  | { status: "idempotent_existing"; note: ProcedureNote }
  | { status: "skipped_no_case"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Generate a Procedure Note for the given ancillary case after report upload.
 */
export async function generateProcedureNoteFromReport(
  input: ProcedureNoteGenerationInput,
): Promise<ProcedureNoteGenerationResult> {
  if (!input.ancillaryCaseId) {
    return { status: "skipped_no_case", reason: "No ancillary case ID provided" };
  }

  // Idempotency: check if a non-superseded post_procedure_note already exists
  // for this ancillary case.
  const [existing] = await db
    .select()
    .from(procedureNotes)
    .where(
      and(
        eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
        eq(procedureNotes.noteType, "post_procedure_note"),
        isNull(procedureNotes.supersededAt),
      ),
    )
    .limit(1);

  if (existing) {
    return { status: "idempotent_existing", note: existing };
  }

  // Gather the clinical chain
  const orderNote = await getActiveOrderNoteForCase(input.ancillaryCaseId);
  const addenda = orderNote ? await listAddendaForNote(orderNote.id) : [];

  // Build the Procedure Note content
  const content = buildProcedureNoteContent({
    input,
    orderNote,
    addenda: addenda.map((a) => ({
      title: a.title,
      content: a.content,
      addendumType: a.addendumType,
      createdAt: a.createdAt,
    })),
  });

  // Create the Procedure Note in procedure_notes table
  const [created] = await db
    .insert(procedureNotes)
    .values({
      clinicId: input.clinicId,
      executionCaseId: input.executionCaseId,
      patientScreeningId: input.patientScreeningId,
      ancillaryCaseId: input.ancillaryCaseId,
      serviceType: input.serviceType,
      noteType: "post_procedure_note",
      generationStatus: "generated",
      generatedText: content,
      generatedByAi: false,
      sourceData: {
        orderNoteId: orderNote?.id ?? null,
        orderNoteSignatureStatus: orderNote?.signatureStatus ?? null,
        addendaCount: addenda.length,
        reportReadinessId: input.reportReadinessId,
        reportMetadata: input.reportMetadata,
        generatedAt: new Date().toISOString(),
      },
      // Route directly to clinician signature worklist
      signatureStatus: "needs_signature",
    })
    .returning();

  return { status: "generated", note: created };
}

// ─── Content Builder ──────────────────────────────────────────────────────

function buildProcedureNoteContent(args: {
  input: ProcedureNoteGenerationInput;
  orderNote: ProcedureNote | undefined;
  addenda: Array<{
    title: string | null;
    content: string;
    addendumType: string;
    createdAt: Date;
  }>;
}): string {
  const { input, orderNote, addenda } = args;
  const lines: string[] = [];

  // Header
  lines.push("PROCEDURE NOTE");
  lines.push("═".repeat(60));
  lines.push("");

  // Patient / Service Info
  lines.push(`Patient: ${input.patientName}`);
  if (input.patientDob) lines.push(`DOB: ${input.patientDob}`);
  if (input.facilityId) lines.push(`Facility: ${input.facilityId}`);
  lines.push(`Service: ${input.serviceType}`);
  lines.push(`Date of Service: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  // Section 1: Original Order Note / Clinical Justification
  lines.push("─".repeat(60));
  lines.push("ORIGINAL ORDER INDICATION / JUSTIFICATION");
  lines.push("─".repeat(60));
  lines.push("");
  if (orderNote?.generatedText) {
    lines.push(orderNote.generatedText);
  } else {
    lines.push("[No Order Note available for this service episode]");
  }
  lines.push("");

  // Section 2: Screening Addenda (additional clinical justification)
  const screeningAddenda = addenda.filter((a) => a.addendumType === "screening_addendum");
  if (screeningAddenda.length > 0) {
    lines.push("─".repeat(60));
    lines.push("SCREENING ADDENDUM / ADDITIONAL CLINICAL JUSTIFICATION");
    lines.push("─".repeat(60));
    lines.push("");
    for (const addendum of screeningAddenda) {
      if (addendum.title) lines.push(`[${addendum.title}]`);
      lines.push(addendum.content);
      lines.push("");
    }
  }

  // Section 3: Procedure Details
  lines.push("─".repeat(60));
  lines.push("PROCEDURE PERFORMED");
  lines.push("─".repeat(60));
  lines.push("");
  lines.push(`Test: ${input.serviceType}`);
  lines.push(`Date Performed: ${new Date().toISOString().slice(0, 10)}`);
  if (input.facilityId) lines.push(`Location: ${input.facilityId}`);
  lines.push("");

  // Section 4: Report Reference
  lines.push("─".repeat(60));
  lines.push("DIAGNOSTIC REPORT REFERENCE");
  lines.push("─".repeat(60));
  lines.push("");
  lines.push(`Report Status: Uploaded / Finalized`);
  lines.push(`Report Reference ID: cdr:${input.reportReadinessId}`);
  const reportNote = input.reportMetadata?.note;
  if (reportNote && typeof reportNote === "string") {
    lines.push(`Report Notes: ${reportNote}`);
  }
  lines.push("");

  // Footer
  lines.push("═".repeat(60));
  lines.push("This Procedure Note was generated from the complete clinical chain:");
  lines.push("  • Original Order Note and clinical justification");
  if (screeningAddenda.length > 0) {
    lines.push("  • Screening Form Addendum with additional clinical findings");
  }
  lines.push("  • Procedure details and test completion");
  lines.push("  • Uploaded diagnostic report");
  lines.push("");
  lines.push("Pending clinician review and signature.");

  return lines.join("\n");
}
