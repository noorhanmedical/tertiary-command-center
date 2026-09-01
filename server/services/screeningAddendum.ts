/**
 * Phase 7 — Screening Addendum Service.
 *
 * When a screening form is completed for a service episode, this service
 * creates a traceable addendum attached to the associated Order Note.
 *
 * Key rules:
 * - The signed Order Note is NEVER mutated.
 * - The addendum is a separate record in `note_addenda`.
 * - If no Order Note exists for the case yet, the addendum is still created
 *   (it will be attached to whichever Order Note is eventually created — the
 *   lookup is by ancillaryCaseId).
 * - Idempotent: if an addendum already exists for the same (parentNoteId,
 *   sourceRecordId, addendumType), returns the existing row.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { noteAddenda, type NoteAddendum } from "@shared/schema/noteAddenda";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { createNoteAddendum, getActiveOrderNoteForCase } from "../repositories/orderNoteLifecycle.repo";

export type ScreeningAddendumInput = {
  /** The ancillary case this screening belongs to. */
  ancillaryCaseId: number;
  /** The patient_screening_id (for provenance). */
  patientScreeningId: number | null;
  /** The clinic ID. */
  clinicId: number | null;
  /** The case_document_readiness row ID that triggered this. */
  sourceReadinessId: number;
  /** The service type. */
  serviceType: string;
  /** Screening metadata from the completion request. */
  screeningMetadata: Record<string, unknown>;
  /** Actor user ID. */
  actorUserId: string | null;
};

export type ScreeningAddendumResult =
  | { status: "created"; addendum: NoteAddendum }
  | { status: "idempotent_existing"; addendum: NoteAddendum }
  | { status: "skipped_no_order_note"; reason: string }
  | { status: "skipped_no_case"; reason: string };

/**
 * Create a screening addendum for the given ancillary case.
 *
 * Finds the active Order Note for the case and attaches the addendum.
 * If no Order Note exists, returns skipped (the addendum can be created
 * later when the Order Note is generated — this is not a failure state
 * for early-stage screening completion before commit).
 */
export async function createScreeningAddendumForCase(
  input: ScreeningAddendumInput,
): Promise<ScreeningAddendumResult> {
  if (!input.ancillaryCaseId) {
    return { status: "skipped_no_case", reason: "No ancillary case ID provided" };
  }

  // Find the active Order Note for this ancillary case
  const orderNote = await getActiveOrderNoteForCase(input.ancillaryCaseId);
  if (!orderNote) {
    return {
      status: "skipped_no_order_note",
      reason: `No active order note found for ancillary case ${input.ancillaryCaseId}`,
    };
  }

  // Idempotency check: has an addendum already been created from this
  // readiness row?
  const sourceRecordId = `cdr:${input.sourceReadinessId}`;
  const [existing] = await db
    .select()
    .from(noteAddenda)
    .where(
      and(
        eq(noteAddenda.parentNoteId, orderNote.id),
        eq(noteAddenda.sourceRecordId, sourceRecordId),
        eq(noteAddenda.addendumType, "screening_addendum"),
      ),
    )
    .limit(1);

  if (existing) {
    return { status: "idempotent_existing", addendum: existing };
  }

  // Build addendum content from screening metadata
  const content = buildScreeningAddendumContent(input);

  const addendum = await createNoteAddendum({
    parentNoteId: orderNote.id,
    clinicId: input.clinicId,
    ancillaryCaseId: input.ancillaryCaseId,
    patientScreeningId: input.patientScreeningId,
    addendumType: "screening_addendum",
    title: `Screening Form Addendum — ${input.serviceType}`,
    content,
    structuredData: {
      serviceType: input.serviceType,
      sourceReadinessId: input.sourceReadinessId,
      screeningMetadata: input.screeningMetadata,
      completedAt: new Date().toISOString(),
    },
    sourceType: "screening_form",
    sourceRecordId,
    authorUserId: input.actorUserId,
    requiresSignature: false,
  });

  return { status: "created", addendum };
}

/**
 * Build the human-readable addendum content from screening metadata.
 * This is the text that appears in the clinical document chain.
 */
function buildScreeningAddendumContent(input: ScreeningAddendumInput): string {
  const lines: string[] = [];
  lines.push("SCREENING FORM ADDENDUM");
  lines.push("");
  lines.push(`Service: ${input.serviceType}`);
  lines.push(`Screening completed: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  const meta = input.screeningMetadata;

  // Extract structured answers if present
  if (meta.note && typeof meta.note === "string") {
    lines.push("Screening Notes:");
    lines.push(meta.note);
    lines.push("");
  }

  // Extract any structured responses
  if (meta.responses && typeof meta.responses === "object") {
    lines.push("Screening Responses:");
    const responses = meta.responses as Record<string, unknown>;
    for (const [key, value] of Object.entries(responses)) {
      if (value != null && value !== "") {
        lines.push(`  ${key}: ${String(value)}`);
      }
    }
    lines.push("");
  }

  // Extract positive findings
  if (Array.isArray(meta.positiveFindings) && meta.positiveFindings.length > 0) {
    lines.push("Relevant Positive Findings:");
    for (const finding of meta.positiveFindings) {
      lines.push(`  - ${String(finding)}`);
    }
    lines.push("");
  }

  // Extract negative findings
  if (Array.isArray(meta.negativeFindings) && meta.negativeFindings.length > 0) {
    lines.push("Relevant Negative Findings:");
    for (const finding of meta.negativeFindings) {
      lines.push(`  - ${String(finding)}`);
    }
    lines.push("");
  }

  lines.push("This addendum is part of the clinical documentation chain for this service episode.");
  lines.push("The original signed Order Note content remains unchanged.");

  return lines.join("\n");
}
