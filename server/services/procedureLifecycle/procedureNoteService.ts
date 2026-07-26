/**
 * Phase 2F — canonical Procedure Note foundation.
 *
 * The canonical Procedure Note is a procedure_notes row (note_type =
 * 'post_procedure_note') — Phase 2F REUSES it (never a competing note store)
 * and indexes it in ancillary_document_references (documentKind='procedure_note').
 * It delegates the two-condition eligibility to
 * evaluateProcedureNoteEligibility and, when eligible, reuses the current
 * case-scoped note or creates one. It NEVER generates clinical text and NEVER
 * auto-signs: generationStatus stays 'pending', signatureStatus stays
 * 'needs_signature'. A signed note is returned unchanged. Ambiguous legacy
 * notes are deferred to durable retry — never adopted first/newest.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../../lib/featureFlags";
import {
  PROCEDURE_NOTE_SOURCE_TABLE,
  ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES,
} from "@shared/schema/ancillaryDocuments";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import {
  createReference,
  recordAncillaryDocumentFailure,
} from "../../repositories/ancillaryDocuments.repo";
import {
  evaluateProcedureNoteEligibility,
  type ProcedureNoteEligibilityResult,
} from "./procedureNoteEligibility";

const AUDIT_SENTINEL_NAME = "[ancillary_document_audit]";

export type CreateOrReuseProcedureNoteInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  effectiveClinicalDate?: Date | null;
  source: string;
};

export type CreateOrReuseProcedureNoteResult =
  | { status: "skipped_flag_off" }
  | { status: "case_not_found" }
  | { status: "cross_clinic_denied" }
  | { status: "ineligible"; eligibility: ProcedureNoteEligibilityResult }
  | {
      // A legacy screening/service Procedure Note exists but cannot be
      // deterministically associated with exactly one ancillary case. NEVER
      // auto-attach to first/newest; durable retry is recorded.
      status: "deferred_legacy_ambiguous";
      ancillaryCaseId: number;
      serviceType: string;
      reason: "multiple_candidate_cases" | "multiple_legacy_notes";
      legacyNoteIds: number[];
    }
  | {
      status: "created" | "reused";
      procedureNoteId: number;
      ancillaryCaseId: number;
      serviceType: string;
      documentStatus: string;
      referenceId?: number;
      referenceDeferred: boolean;
      qualifyingProcedureEventId?: number;
      qualifyingReportReferenceId?: number;
      adoptedLegacy: boolean;
      warnings: string[];
    };

async function appendAudit(args: {
  eventType: string;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  actorUserId: string | null;
  source: string;
  summary: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME,
      patientDob: null,
      patientScreeningId: args.patientScreeningId,
      executionCaseId: args.executionCaseId,
      eventType: args.eventType,
      eventSource: args.source,
      actorUserId: args.actorUserId,
      summary: args.summary,
      metadata: args.metadata,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn", source: "ancillary_document", kind: "audit_write_failed",
      eventType: args.eventType, code: (e as { code?: string })?.code,
    }));
  }
}

type AncillaryCaseShape = {
  clinicId: number;
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
  originatingScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string;
};

export async function createOrReuseProcedureNote(
  input: CreateOrReuseProcedureNoteInput,
): Promise<CreateOrReuseProcedureNoteResult> {
  if (!featureFlags.canonicalProcedureNote) return { status: "skipped_flag_off" };

  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  if (!acase) return { status: "case_not_found" };
  if (acase.clinicId !== input.clinicId) return { status: "cross_clinic_denied" };

  const eligibility = await evaluateProcedureNoteEligibility({
    clinicId: input.clinicId,
    ancillaryCaseId: input.ancillaryCaseId,
  });

  await appendAudit({
    eventType: ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.procedureNoteEligibilityEvaluated,
    patientScreeningId: acase.originatingScreeningId ?? null,
    executionCaseId: acase.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    summary: `Procedure Note eligibility evaluated (${acase.serviceType})`,
    metadata: {
      clinic_id: input.clinicId,
      ancillary_case_id: input.ancillaryCaseId,
      service_type: acase.serviceType,
      procedure_complete: eligibility.procedureComplete,
      report_associated: eligibility.reportAssociated,
      eligible: eligibility.eligible,
      reason_codes: eligibility.reasons,
    },
  });

  if (!eligibility.eligible) {
    return { status: "ineligible", eligibility };
  }

  const procedureEventId = eligibility.qualifyingProcedureEventId ?? null;
  const reportReferenceId = eligibility.qualifyingReportReferenceId ?? null;
  const warnings: string[] = [];

  // Canonical identity is (ancillary_case_id, note_type='post_procedure_note',
  // superseded_at IS NULL). Reuse the CURRENT case-scoped note or create one —
  // NEVER reuse solely by screening+service (collides across episodes). A
  // signed note is returned unchanged.
  let note = await findCaseScopedProcedureNote(input.ancillaryCaseId);
  let reused = note != null;
  let adoptedLegacy = false;

  if (!note) {
    const legacy = await findLegacyUnlinkedProcedureNotes(acase);
    if (legacy.length > 1) {
      await recordLegacyLinkRetry(input, acase, "legacy_notes_multiple");
      return {
        status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
        serviceType: acase.serviceType, reason: "multiple_legacy_notes",
        legacyNoteIds: legacy.map((r) => r.id),
      };
    }
    if (legacy.length === 1) {
      const candidateCaseCount = await countCandidateCasesForLegacy(acase);
      if (candidateCaseCount !== 1) {
        await recordLegacyLinkRetry(input, acase, "legacy_note_ambiguous_case");
        return {
          status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
          serviceType: acase.serviceType, reason: "multiple_candidate_cases",
          legacyNoteIds: legacy.map((r) => r.id),
        };
      }
      note = await adoptLegacyProcedureNote(legacy[0].id, input, acase, procedureEventId, reportReferenceId);
      reused = true;
      adoptedLegacy = true;
    } else {
      note = await insertProcedureNote(input, acase, procedureEventId, reportReferenceId);
      reused = false;
    }
  }

  // Never auto-sign. Mirror the note's current signature status only.
  const documentStatus = note.signatureStatus === "signed" ? "signed" : "pending_signature";

  // Append the unified Ancillary Documents reference (best-effort + durable
  // retry — the note already exists and must not be lost).
  let referenceId: number | undefined;
  let referenceDeferred = false;
  try {
    const ref = await createReference({
      clinicId: input.clinicId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      ancillaryCaseId: input.ancillaryCaseId,
      documentKind: "procedure_note",
      sourceSystem: input.source,
      sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
      sourceId: note.id,
      serviceType: acase.serviceType,
      documentStatus,
      effectiveClinicalDate: input.effectiveClinicalDate ?? null,
      signedAt: note.signedAt ?? null,
      // Preserve the SOURCE note's creation instant, not the index time.
      actualCreatedAt: note.createdAt ?? null,
      createdByUserId: input.actorUserId ?? null,
      metadata: {
        procedure_event_id: procedureEventId,
        report_document_reference_id: reportReferenceId,
      },
    });
    if (ref.outcome === "created") {
      referenceId = ref.row.id;
    } else if (ref.outcome === "reused_exact_source_unchanged" || ref.outcome === "reused_exact_source_updated") {
      referenceId = ref.existing.id;
    } else {
      // Ownership/slot conflict — NEVER attach this note to another owner's
      // reference id. Defer to a reviewed supersession via a source-specific retry.
      referenceDeferred = true;
      try {
        await recordAncillaryDocumentFailure({
          clinicId: input.clinicId,
          ancillaryCaseId: input.ancillaryCaseId,
          patientScreeningId: acase.originatingScreeningId ?? null,
          executionCaseId: acase.executionCaseId ?? null,
          documentKind: "procedure_note",
          sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
          sourceId: note.id,
          requestedAction: "link_procedure_note",
          sourceSystem: input.source,
          errorCode: ref.outcome,
        });
      } catch { /* ledger guard downstream */ }
    }
  } catch (e) {
    referenceDeferred = true;
    try {
      await recordAncillaryDocumentFailure({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId,
        patientScreeningId: acase.originatingScreeningId ?? null,
        executionCaseId: acase.executionCaseId ?? null,
        documentKind: "procedure_note",
        sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
        sourceId: note.id,
        requestedAction: "link_procedure_note",
        sourceSystem: input.source,
        errorCode: (e as { code?: string })?.code ?? "reference_failed",
      });
    } catch { /* ledger guard downstream */ }
  }

  await appendAudit({
    eventType: reused
      ? ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.procedureNoteReused
      : ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.procedureNoteCreated,
    patientScreeningId: acase.originatingScreeningId ?? null,
    executionCaseId: acase.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    summary: `Procedure Note ${reused ? "reused" : "created"} (${acase.serviceType})`,
    metadata: {
      clinic_id: input.clinicId,
      ancillary_case_id: input.ancillaryCaseId,
      service_type: acase.serviceType,
      source_table: PROCEDURE_NOTE_SOURCE_TABLE,
      source_id: note.id,
      document_reference_id: referenceId ?? null,
      procedure_event_id: procedureEventId,
      report_document_reference_id: reportReferenceId,
      adopted_legacy: adoptedLegacy,
      new_status: documentStatus,
      reference_deferred: referenceDeferred,
    },
  });
  if (documentStatus === "pending_signature") {
    await appendAudit({
      eventType: ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.procedureNotePendingSignature,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
      summary: `Procedure Note pending signature (${acase.serviceType})`,
      metadata: { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, source_id: note.id },
    });
  }

  return {
    status: reused ? "reused" : "created",
    procedureNoteId: note.id,
    ancillaryCaseId: input.ancillaryCaseId,
    serviceType: acase.serviceType,
    documentStatus,
    referenceId,
    referenceDeferred,
    qualifyingProcedureEventId: eligibility.qualifyingProcedureEventId,
    qualifyingReportReferenceId: eligibility.qualifyingReportReferenceId,
    adoptedLegacy,
    warnings,
  };
}

/** The CURRENT (non-superseded) canonical Procedure Note for this case. */
async function findCaseScopedProcedureNote(
  ancillaryCaseId: number,
): Promise<typeof procedureNotes.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(procedureNotes)
    .where(and(
      eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
      eq(procedureNotes.noteType, "post_procedure_note"),
      isNull(procedureNotes.supersededAt),
    ))
    .limit(1);
  return row ?? null;
}

/** Legacy post_procedure_note rows for the same screening|execution + service
 *  that predate case linkage (ancillary_case_id NULL, not superseded). */
async function findLegacyUnlinkedProcedureNotes(
  acase: AncillaryCaseShape,
): Promise<Array<typeof procedureNotes.$inferSelect>> {
  const conds = [
    eq(procedureNotes.serviceType, acase.serviceType),
    eq(procedureNotes.noteType, "post_procedure_note"),
    isNull(procedureNotes.ancillaryCaseId),
    isNull(procedureNotes.supersededAt),
  ];
  if (acase.originatingScreeningId != null) {
    conds.push(eq(procedureNotes.patientScreeningId, acase.originatingScreeningId));
  } else if (acase.executionCaseId != null) {
    conds.push(eq(procedureNotes.executionCaseId, acase.executionCaseId));
  } else {
    return [];
  }
  return db.select().from(procedureNotes).where(and(...conds)).limit(5);
}

/** How many ancillary cases share this legacy note's identity? Deterministically
 *  ownable only when the answer is exactly 1. */
async function countCandidateCasesForLegacy(acase: AncillaryCaseShape): Promise<number> {
  const conds = [
    eq(patientAncillaryCases.clinicId, acase.clinicId),
    eq(patientAncillaryCases.serviceType, acase.serviceType),
  ];
  if (acase.originatingScreeningId != null) {
    conds.push(eq(patientAncillaryCases.originatingScreeningId, acase.originatingScreeningId));
  } else if (acase.executionCaseId != null) {
    conds.push(eq(patientAncillaryCases.executionCaseId, acase.executionCaseId));
  } else {
    return 0;
  }
  const rows = await db.select({ id: patientAncillaryCases.id }).from(patientAncillaryCases).where(and(...conds)).limit(3);
  return rows.length;
}

async function recordLegacyLinkRetry(
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  errorCode: string,
): Promise<void> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      documentKind: "procedure_note",
      sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
      requestedAction: "link_procedure_note",
      sourceSystem: input.source,
      errorCode,
    });
  } catch { /* ledger guard downstream */ }
}

/** Deterministic legacy adoption: LINK-ONLY update. NEVER touches the clinical
 *  body, signature status, signedAt, or signer. */
async function adoptLegacyProcedureNote(
  id: number,
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  procedureEventId: number | null,
  reportReferenceId: number | null,
): Promise<typeof procedureNotes.$inferSelect> {
  const [row] = await db
    .update(procedureNotes)
    .set({
      ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      procedureEventId: procedureEventId ?? undefined,
      reportDocumentReferenceId: reportReferenceId ?? undefined,
      effectiveClinicalDate: input.effectiveClinicalDate ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(procedureNotes.id, id))
    .returning();
  return row;
}

async function insertProcedureNote(
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  procedureEventId: number | null,
  reportReferenceId: number | null,
): Promise<typeof procedureNotes.$inferSelect> {
  // actual created_at is server-owned (schema default) — never backdated.
  // generationStatus 'pending' (no content generated). signatureStatus
  // 'needs_signature' (never auto-signed). Identity anchored to the case +
  // immutable procedure/report evidence.
  const [row] = await db
    .insert(procedureNotes)
    .values({
      clinicId: input.clinicId,
      executionCaseId: acase.executionCaseId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? null,
      serviceType: acase.serviceType,
      noteType: "post_procedure_note",
      generationStatus: "pending",
      signatureStatus: "needs_signature",
      ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      procedureEventId: procedureEventId ?? null,
      reportDocumentReferenceId: reportReferenceId ?? null,
      effectiveClinicalDate: input.effectiveClinicalDate ?? null,
    })
    .returning();
  return row;
}
