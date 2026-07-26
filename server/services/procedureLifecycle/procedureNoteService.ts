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
  ancillaryDocumentReferences,
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
      // deterministically associated with exactly one ancillary case, or the
      // deterministic adoption lost a zero-row race. NEVER auto-attach to
      // first/newest; durable retry is recorded (retryRecorded reflects whether
      // the ledger row was actually persisted — never overstate durability).
      status: "deferred_legacy_ambiguous";
      ancillaryCaseId: number;
      serviceType: string;
      reason: "multiple_candidate_cases" | "multiple_legacy_notes" | "adoption_zero_row";
      legacyNoteIds: number[];
      retryRecorded: boolean;
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
  // Both flags required: the reference write needs the Phase 2E index; either
  // OFF ⇒ zero Phase 2F reads/writes.
  if (!featureFlags.canonicalProcedureNote || !featureFlags.unifiedAncillaryDocuments) {
    return { status: "skipped_flag_off" };
  }

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
  // Timeless clinical date defaults to the qualifying procedure's ACTUAL
  // completedAt — never the hook/retry time — when the caller supplies none.
  const effectiveDate = input.effectiveClinicalDate ?? eligibility.procedureCompletedAt ?? null;

  // Canonical identity is (ancillary_case_id, note_type='post_procedure_note',
  // superseded_at IS NULL). Reuse the CURRENT case-scoped note or create one —
  // NEVER reuse solely by screening+service (collides across episodes). A
  // signed note is returned unchanged.
  let note = await findCaseScopedProcedureNote(input.ancillaryCaseId);
  let reused = note != null;
  let adoptedLegacy = false;

  if (!note) {
    const legacy = await findLegacyUnlinkedProcedureNotes(input.clinicId, acase);
    if (legacy.length > 1) {
      const retryRecorded = await recordLegacyLinkRetry(input, acase, "legacy_notes_multiple");
      return {
        status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
        serviceType: acase.serviceType, reason: "multiple_legacy_notes",
        legacyNoteIds: legacy.map((r) => r.id), retryRecorded,
      };
    }
    if (legacy.length === 1) {
      const candidateCaseCount = await countCandidateCasesForLegacy(acase);
      if (candidateCaseCount !== 1) {
        const retryRecorded = await recordLegacyLinkRetry(input, acase, "legacy_note_ambiguous_case");
        return {
          status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
          serviceType: acase.serviceType, reason: "multiple_candidate_cases",
          legacyNoteIds: legacy.map((r) => r.id), retryRecorded,
        };
      }
      const adopted = await adoptLegacyProcedureNote(legacy[0].id, input, acase, procedureEventId, reportReferenceId, effectiveDate);
      if (!adopted) {
        // Zero-row race (another writer linked/superseded it first) — NEVER
        // report success; defer with a truthful retry-persistence flag.
        const retryRecorded = await recordLegacyLinkRetry(input, acase, "legacy_adoption_zero_row");
        return {
          status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
          serviceType: acase.serviceType, reason: "adoption_zero_row",
          legacyNoteIds: [legacy[0].id], retryRecorded,
        };
      }
      note = adopted;
      reused = true;
      adoptedLegacy = true;
    } else {
      note = await insertProcedureNote(input, acase, procedureEventId, reportReferenceId, effectiveDate);
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
      effectiveClinicalDate: effectiveDate,
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

/** Legacy post_procedure_note rows for the same clinic + screening|execution +
 *  service that predate case linkage (ancillary_case_id NULL, not superseded).
 *  CLINIC-SCOPED — never considers another clinic's legacy notes. */
async function findLegacyUnlinkedProcedureNotes(
  clinicId: number,
  acase: AncillaryCaseShape,
): Promise<Array<typeof procedureNotes.$inferSelect>> {
  const conds = [
    eq(procedureNotes.clinicId, clinicId),
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

/** Records a PHI-free durable retry; returns whether the ledger row was
 *  actually persisted (never overstate deferred durability). Source-less
 *  (sourceId null) case-level link_procedure_note. */
async function recordLegacyLinkRetry(
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  errorCode: string,
): Promise<boolean> {
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
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic legacy adoption: LINK-ONLY update, tenant + current + unlinked
 * scoped. The WHERE requires the EXACT note id + clinic + note_type +
 * ancillary_case_id IS NULL + superseded_at IS NULL, and `.returning()` must
 * affect exactly one row. A zero-row race (another writer linked/superseded it
 * first) returns null (deferred), never a false success. NEVER touches
 * generatedText, sourceData, signatureStatus, signedAt, or signedByUserId.
 */
async function adoptLegacyProcedureNote(
  id: number,
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  procedureEventId: number | null,
  reportReferenceId: number | null,
  effectiveDate: Date | null,
): Promise<typeof procedureNotes.$inferSelect | null> {
  const rows = await db
    .update(procedureNotes)
    .set({
      ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      procedureEventId: procedureEventId ?? undefined,
      reportDocumentReferenceId: reportReferenceId ?? undefined,
      effectiveClinicalDate: effectiveDate ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(
      eq(procedureNotes.id, id),
      eq(procedureNotes.clinicId, input.clinicId),
      eq(procedureNotes.noteType, "post_procedure_note"),
      isNull(procedureNotes.ancillaryCaseId),
      isNull(procedureNotes.supersededAt),
    ))
    .returning();
  return rows.length === 1 ? rows[0] : null;
}

async function insertProcedureNote(
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  procedureEventId: number | null,
  reportReferenceId: number | null,
  effectiveDate: Date | null,
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
      effectiveClinicalDate: effectiveDate,
    })
    .returning();
  return row;
}

// ─── Phase 2F — Procedure Note evidence linker (retry worker entry) ─────────
export type ProcedureNoteEvidenceRetryResult =
  | { status: "skipped_flag_off" }
  | { status: "still_deferred" }
  | { status: "not_yet_eligible" }
  | { status: "cross_clinic_denied" }
  | { status: "note_case_mismatch" }
  | { status: "source_not_found" }
  | { status: "source_type_mismatch" }
  | { status: "linked"; procedureNoteId: number };

export type ProcedureNoteEvidenceRetryInput = {
  clinicId: number;
  ancillaryCaseId: number | null;
  sourceId: number | null;
};

/**
 * Link/refresh a current Procedure Note's IMMUTABLE evidence (procedureEventId +
 * reportDocumentReferenceId) once exact eligibility evidence is resolvable.
 * Fully tenant-validated: the note must exist, be same-clinic, same-case,
 * post_procedure_note, and NOT superseded. LINK-ONLY — never touches
 * generatedText, sourceData, signatureStatus, signedAt, or signedByUserId. A
 * SIGNED current note is left UNCHANGED (evidence changes on a signed clinical
 * note require reviewed supersession/correction, never a silent rewrite).
 * Requires BOTH flags; either OFF ⇒ zero reads/writes.
 */
export async function linkProcedureNoteEvidence(
  input: ProcedureNoteEvidenceRetryInput,
): Promise<ProcedureNoteEvidenceRetryResult> {
  if (!featureFlags.canonicalProcedureNote || !featureFlags.unifiedAncillaryDocuments) {
    return { status: "skipped_flag_off" };
  }
  const { clinicId, ancillaryCaseId, sourceId } = input;
  if (ancillaryCaseId == null || sourceId == null) return { status: "still_deferred" };

  const acase = await getAncillaryCaseById(ancillaryCaseId);
  if (!acase) return { status: "still_deferred" };
  if (acase.clinicId !== clinicId) return { status: "cross_clinic_denied" };

  const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, sourceId)).limit(1);
  if (!note) return { status: "source_not_found" };
  if (note.clinicId !== clinicId) return { status: "cross_clinic_denied" };
  if (note.ancillaryCaseId !== ancillaryCaseId) return { status: "note_case_mismatch" };
  if (note.noteType !== "post_procedure_note") return { status: "source_type_mismatch" };
  if (note.supersededAt != null) return { status: "still_deferred" };

  const elig = await evaluateProcedureNoteEligibility({ clinicId, ancillaryCaseId });
  if (!elig.eligible) return { status: "not_yet_eligible" };

  // A signed clinical note is never silently rewritten — defer to reviewed handling.
  if (note.signatureStatus === "signed") return { status: "still_deferred" };

  const procedureEventId = elig.qualifyingProcedureEventId ?? null;
  const reportReferenceId = elig.qualifyingReportReferenceId ?? null;

  // Evidence-only, exact clinic/case/current-note scoped write + affected-row check.
  const rows = await db
    .update(procedureNotes)
    .set({ procedureEventId: procedureEventId ?? undefined, reportDocumentReferenceId: reportReferenceId ?? undefined, updatedAt: new Date() })
    .where(and(
      eq(procedureNotes.id, sourceId),
      eq(procedureNotes.clinicId, clinicId),
      eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
      isNull(procedureNotes.supersededAt),
    ))
    .returning();
  if (rows.length !== 1) return { status: "still_deferred" };

  // Best-effort reference metadata refresh (never identity/ownership).
  try {
    const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
      eq(ancillaryDocumentReferences.sourceId, sourceId),
      eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
    )).limit(1);
    if (ref && ref.clinicId === clinicId && ref.ancillaryCaseId === ancillaryCaseId) {
      const metadata = { ...((ref.metadata as Record<string, unknown>) ?? {}), procedure_event_id: procedureEventId, report_document_reference_id: reportReferenceId };
      await db.update(ancillaryDocumentReferences)
        .set({ metadata: metadata as never, updatedAt: new Date() })
        .where(and(eq(ancillaryDocumentReferences.id, ref.id), eq(ancillaryDocumentReferences.clinicId, clinicId)));
    }
  } catch { /* reference refresh is best-effort; note evidence is already linked */ }

  return { status: "linked", procedureNoteId: sourceId };
}
