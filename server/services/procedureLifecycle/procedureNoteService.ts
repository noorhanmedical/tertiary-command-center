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
import { and, eq, isNull, sql } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags, procedureNoteRuntimeEnabled } from "../../lib/featureFlags";
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
import { amendProcedureNoteLineage } from "./procedureNoteLineage";

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
      // A reused note's evidence sync could not durably complete — NEVER
      // continue with a stale note; the caller sees a truthful deferred result.
      status: "deferred_evidence_sync";
      ancillaryCaseId: number;
      serviceType: string;
      reason: string;
      retryRecorded: boolean;
    }
  | {
      // A generated/signed note whose report evidence changed was superseded and
      // a new pending amendment created (never a silent body rewrite).
      status: "amended";
      ancillaryCaseId: number;
      serviceType: string;
      priorNoteId: number;
      newNoteId?: number;
      wasSigned: boolean;
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
  // The FULL canonical Procedure Note runtime gate (all three flags). Partial
  // enablement ⇒ zero Phase 2F reads/writes (legacy path stays available).
  if (!procedureNoteRuntimeEnabled()) {
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
  } else if (!adoptedLegacy) {
    // A pre-existing case-scoped note is being reused. Reconcile its stored
    // evidence with current eligibility BEFORE indexing.
    const stale = (note.procedureEventId ?? null) !== procedureEventId || (note.reportDocumentReferenceId ?? null) !== reportReferenceId;
    const hasBody = note.generationStatus === "generated" || note.generationStatus === "approved";
    if (note.signatureStatus === "signed") {
      // §6-C — a SIGNED note is immutable. If evidence changed, supersede via an
      // AUDITED amendment (new pending row); the signed body/signer/signedAt are
      // never altered. The (soon-to-be-superseded) reference keeps the signed
      // note's stored evidence.
      if (stale) {
        const amended = await amendProcedureNoteLineage({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, newReportReferenceId: reportReferenceId, procedureEventId, effectiveDate, actorUserId: input.actorUserId ?? null });
        if (amended.status === "amended_reference_created" || amended.status === "amended_reference_retry_recorded") return { status: "amended", ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, priorNoteId: note.id, newNoteId: amended.newNoteId, wasSigned: true };
        const recorded = await recordEvidenceRetry(input, acase, note.id);
        return { status: "deferred_evidence_sync", ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, reason: `signed_${amended.status}`, retryRecorded: recorded };
      }
    } else if (stale && hasBody) {
      // §6-B — a GENERATED unsigned body is never rewritten against new evidence;
      // supersede + create a new pending amendment.
      const amended = await amendProcedureNoteLineage({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, newReportReferenceId: reportReferenceId, procedureEventId, effectiveDate, actorUserId: input.actorUserId ?? null });
      if (amended.status === "amended_reference_created" || amended.status === "amended_reference_retry_recorded") return { status: "amended", ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, priorNoteId: note.id, newNoteId: amended.newNoteId, wasSigned: false };
      const recorded = await recordEvidenceRetry(input, acase, note.id);
      return { status: "deferred_evidence_sync", ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, reason: `generated_${amended.status}`, retryRecorded: recorded };
    } else if (stale) {
      // A PENDING unsigned note (no body): synchronize evidence exactly. Any
      // non-success is a truthful deferral — never continue with a stale note.
      const sync = await synchronizeUnsignedProcedureNoteEvidence({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, noteId: note.id, procedureEventId, reportReferenceId, effectiveDate });
      if (sync.status === "evidence_updated") note = sync.note;
      else if (sync.status !== "evidence_unchanged") {
        const recorded = await recordEvidenceRetry(input, acase, note.id);
        return { status: "deferred_evidence_sync", ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, reason: sync.status, retryRecorded: recorded };
      }
    }
  }

  // Never auto-sign. Mirror the note's current signature status only.
  const documentStatus = note.signatureStatus === "signed" ? "signed" : "pending_signature";
  // §12 — reference evidence metadata is derived from the ACTUAL final note row
  // (its stored procedure/report evidence), NEVER directly from the latest
  // eligibility result (which a signed note may not reflect).
  // §2E — every reference evidence field comes ONLY from the final note row
  // (including a NULL effectiveClinicalDate on a signed note); never a current
  // eligibility fallback.
  const refProcedureEventId = note.procedureEventId ?? null;
  const refReportReferenceId = note.reportDocumentReferenceId ?? null;
  const refEffectiveDate = note.effectiveClinicalDate ?? null;

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
      effectiveClinicalDate: refEffectiveDate,
      signedAt: note.signedAt ?? null,
      // Preserve the SOURCE note's creation instant, not the index time.
      actualCreatedAt: note.createdAt ?? null,
      createdByUserId: input.actorUserId ?? null,
      metadata: {
        procedure_event_id: refProcedureEventId,
        report_document_reference_id: refReportReferenceId,
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

/** PHI-free exact evidence retry (source=procedure_notes, sourceId=noteId).
 *  Returns whether the ledger row was actually persisted. */
async function recordEvidenceRetry(
  input: CreateOrReuseProcedureNoteInput,
  acase: AncillaryCaseShape,
  noteId: number,
): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      documentKind: "procedure_note",
      sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
      sourceId: noteId,
      requestedAction: "link_procedure_note_evidence",
      sourceSystem: input.source,
      errorCode: "signed_evidence_conflict",
    });
    return true;
  } catch {
    return false;
  }
}

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

// ─── Phase 2F §11 — dedicated unsigned-note evidence synchronization ────────
export type SyncEvidenceInput = {
  clinicId: number;
  ancillaryCaseId: number;
  noteId: number;
  procedureEventId: number | null;
  reportReferenceId: number | null;
  effectiveDate: Date | null;
};
export type SyncEvidenceResult =
  | { status: "evidence_unchanged"; note: typeof procedureNotes.$inferSelect }
  | { status: "evidence_updated"; note: typeof procedureNotes.$inferSelect }
  | { status: "signed_evidence_conflict" }
  | { status: "ownership_conflict" }
  | { status: "zero_row_conflict" }
  | { status: "source_not_found" }
  | { status: "migration_missing" };

/**
 * Synchronize a CURRENT UNSIGNED Procedure Note's evidence
 * (procedureEventId / reportDocumentReferenceId / effectiveClinicalDate). Exact
 * clinic/case/current/unsigned predicates; `.returning()` exactly one row.
 * NEVER touches generatedText, sourceData, generationStatus, signatureStatus,
 * signedAt, or signedByUserId. A signed note yields signed_evidence_conflict.
 */
export async function synchronizeUnsignedProcedureNoteEvidence(
  input: SyncEvidenceInput,
): Promise<SyncEvidenceResult> {
  try {
    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, input.noteId)).limit(1);
    if (!note) return { status: "source_not_found" };
    if (note.clinicId !== input.clinicId || note.ancillaryCaseId !== input.ancillaryCaseId) return { status: "ownership_conflict" };
    if (note.noteType !== "post_procedure_note" || note.supersededAt != null) return { status: "ownership_conflict" };
    if (note.signatureStatus === "signed") return { status: "signed_evidence_conflict" };
    const ed = input.effectiveDate ?? null;
    const same = (note.procedureEventId ?? null) === input.procedureEventId
      && (note.reportDocumentReferenceId ?? null) === input.reportReferenceId
      && (note.effectiveClinicalDate?.getTime() ?? null) === (ed?.getTime() ?? null);
    if (same) return { status: "evidence_unchanged", note };
    const rows = await db
      .update(procedureNotes)
      .set({ procedureEventId: input.procedureEventId ?? undefined, reportDocumentReferenceId: input.reportReferenceId ?? undefined, effectiveClinicalDate: ed ?? undefined, updatedAt: new Date() })
      .where(and(
        eq(procedureNotes.id, input.noteId),
        eq(procedureNotes.clinicId, input.clinicId),
        eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
        isNull(procedureNotes.supersededAt),
        sql`${procedureNotes.signatureStatus} IS DISTINCT FROM 'signed'`,
      ))
      .returning();
    if (rows.length !== 1) return { status: "zero_row_conflict" };
    return { status: "evidence_updated", note: rows[0] };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    throw e;
  }
}

// ─── Phase 2F §10 — exact note-source reference retry ───────────────────────
export type NoteSourceReferenceResult =
  | { status: "resolved" }
  | { status: "source_not_found" }
  | { status: "note_case_mismatch" }
  | { status: "cross_clinic_denied" }
  | { status: "source_type_mismatch" }
  | { status: "deferred" }
  | { status: "migration_missing" };

/**
 * Create/reuse ONLY the exact unified reference for a NAMED post_procedure_note
 * (never adopts another note, never picks a case's current note instead). The
 * reference status/signedAt/actualCreatedAt/evidence metadata are all derived
 * from that exact note row.
 */
export async function ensureProcedureNoteReferenceForNote(args: {
  clinicId: number;
  ancillaryCaseId: number;
  noteId: number;
  source: string;
}): Promise<NoteSourceReferenceResult> {
  try {
    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, args.noteId)).limit(1);
    if (!note) return { status: "source_not_found" };
    if (note.clinicId !== args.clinicId) return { status: "cross_clinic_denied" };
    if (note.ancillaryCaseId !== args.ancillaryCaseId) return { status: "note_case_mismatch" };
    if (note.noteType !== "post_procedure_note") return { status: "source_type_mismatch" };
    if (note.supersededAt != null) return { status: "deferred" };
    const acase = await getAncillaryCaseById(args.ancillaryCaseId);
    if (!acase || acase.clinicId !== args.clinicId) return { status: "cross_clinic_denied" };
    const documentStatus = note.signatureStatus === "signed" ? "signed" : "pending_signature";
    const ref = await createReference({
      clinicId: args.clinicId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      ancillaryCaseId: args.ancillaryCaseId,
      documentKind: "procedure_note",
      sourceSystem: args.source,
      sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
      sourceId: note.id,
      serviceType: note.serviceType,
      documentStatus,
      effectiveClinicalDate: note.effectiveClinicalDate ?? null,
      signedAt: note.signedAt ?? null,
      actualCreatedAt: note.createdAt ?? null,
      metadata: { procedure_event_id: note.procedureEventId ?? null, report_document_reference_id: note.reportDocumentReferenceId ?? null },
    });
    if (ref.outcome === "created" || ref.outcome === "reused_exact_source_unchanged" || ref.outcome === "reused_exact_source_updated") {
      return { status: "resolved" };
    }
    return { status: "deferred" };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    return { status: "deferred" };
  }
}

// ─── Phase 2F §13 — atomic Procedure Note evidence linker (retry entry) ─────
export type ProcedureNoteEvidenceRetryResult =
  | { status: "skipped_flag_off" }
  | { status: "still_deferred" }
  | { status: "not_yet_eligible" }
  | { status: "cross_clinic_denied" }
  | { status: "note_case_mismatch" }
  | { status: "source_not_found" }
  | { status: "source_type_mismatch" }
  | { status: "signed_evidence_conflict" }
  | { status: "reference_missing" }
  | { status: "migration_missing" }
  | { status: "linked"; procedureNoteId: number };

export type ProcedureNoteEvidenceRetryInput = {
  clinicId: number;
  ancillaryCaseId: number | null;
  sourceId: number | null;
};

/**
 * Link a current unsigned Procedure Note's evidence AND its reference metadata
 * ATOMICALLY. Validates the exact note + exact reference before mutation; both
 * updates run in one transaction and each must affect exactly one row — a
 * reference failure rolls back the note evidence update, so `linked` is
 * returned ONLY when all required writes succeeded. A missing reference returns
 * `reference_missing` (a separate exact link_procedure_note retry creates it).
 * A SIGNED note is left unchanged (signed_evidence_conflict). Full runtime gate.
 */
export async function linkProcedureNoteEvidence(
  input: ProcedureNoteEvidenceRetryInput,
): Promise<ProcedureNoteEvidenceRetryResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
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
  if (note.signatureStatus === "signed") return { status: "signed_evidence_conflict" };

  const elig = await evaluateProcedureNoteEligibility({ clinicId, ancillaryCaseId });
  if (!elig.eligible) return { status: "not_yet_eligible" };
  const procedureEventId = elig.qualifyingProcedureEventId ?? null;
  const reportReferenceId = elig.qualifyingReportReferenceId ?? null;

  // The exact reference must already exist — otherwise leave a separate exact
  // link_procedure_note retry to create it (never fabricate here).
  const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
    eq(ancillaryDocumentReferences.sourceId, sourceId),
    eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
  )).limit(1);
  if (!ref) return { status: "reference_missing" };
  if (ref.clinicId !== clinicId || ref.ancillaryCaseId !== ancillaryCaseId) return { status: "note_case_mismatch" };

  try {
    await db.transaction(async (tx) => {
      const noteRows = await tx
        .update(procedureNotes)
        .set({ procedureEventId: procedureEventId ?? undefined, reportDocumentReferenceId: reportReferenceId ?? undefined, updatedAt: new Date() })
        .where(and(
          eq(procedureNotes.id, sourceId),
          eq(procedureNotes.clinicId, clinicId),
          eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
          isNull(procedureNotes.supersededAt),
          sql`${procedureNotes.signatureStatus} IS DISTINCT FROM 'signed'`,
        ))
        .returning();
      if (noteRows.length !== 1) throw new EvidenceTxError("note");
      const metadata = { ...((ref.metadata as Record<string, unknown>) ?? {}), procedure_event_id: procedureEventId, report_document_reference_id: reportReferenceId };
      const refRows = await tx
        .update(ancillaryDocumentReferences)
        .set({ metadata: metadata as never, updatedAt: new Date() })
        .where(and(
          eq(ancillaryDocumentReferences.id, ref.id),
          eq(ancillaryDocumentReferences.clinicId, clinicId),
          eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId),
          eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
          eq(ancillaryDocumentReferences.sourceId, sourceId),
          eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
        ))
        .returning();
      if (refRows.length !== 1) throw new EvidenceTxError("reference");
    });
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    // Note + reference updates rolled back together — never partial success.
    return { status: "still_deferred" };
  }
  return { status: "linked", procedureNoteId: sourceId };
}

class EvidenceTxError extends Error {
  constructor(public kind: "note" | "reference") { super(kind); }
}

// ─── §8 — Procedure Note signature → reference synchronization ───────────────
export type ProcedureNoteSignatureSyncResult =
  | { status: "skipped_flag_off" }
  | { status: "synced" }
  | { status: "no_reference"; retryRecorded: boolean }
  | { status: "cross_clinic_denied" }
  | { status: "case_mismatch" }
  | { status: "migration_missing" }
  | { status: "sync_failed"; retryRecorded: boolean };

const SIG_MIGRATION_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

async function recordSignatureSyncRetry(clinicId: number, ancillaryCaseId: number | null, noteId: number): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId, ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
      sourceId: noteId, requestedAction: "sync_procedure_note_signature", sourceSystem: "procedure_note_signature_sync",
      errorCode: "PROCEDURE_NOTE_REFERENCE_MISSING_AFTER_SIGNATURE",
    });
    return true;
  } catch { return false; }
}

/**
 * Mirror a committed canonical post_procedure_note signature transition onto its
 * EXACT unified reference (documentStatus + signedAt only). Validates clinic +
 * ancillary case; NEVER throws (a sync failure must not reverse the successful
 * sign/return); full runtime gate (OFF ⇒ zero reference reads/writes). Missing
 * reference → exact PHI-free retry. Order Note sync is untouched.
 */
export async function syncProcedureNoteReferenceSignature(args: {
  clinicId: number; ancillaryCaseId: number | null; noteId: number;
  documentStatus: "signed" | "pending_signature"; signedAt: Date | null;
}): Promise<ProcedureNoteSignatureSyncResult> {
  if (!procedureNoteRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
      eq(ancillaryDocumentReferences.sourceId, args.noteId),
      eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
    )).limit(1);
    if (!ref) return { status: "no_reference", retryRecorded: await recordSignatureSyncRetry(args.clinicId, args.ancillaryCaseId, args.noteId) };
    if (ref.clinicId !== args.clinicId) return { status: "cross_clinic_denied" };
    if (args.ancillaryCaseId != null && ref.ancillaryCaseId !== args.ancillaryCaseId) return { status: "case_mismatch" };
    const updated = await db.update(ancillaryDocumentReferences)
      .set({ documentStatus: args.documentStatus, signedAt: args.signedAt, updatedAt: new Date() })
      .where(and(
        eq(ancillaryDocumentReferences.id, ref.id), eq(ancillaryDocumentReferences.clinicId, args.clinicId),
        eq(ancillaryDocumentReferences.ancillaryCaseId, ref.ancillaryCaseId),
        eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE),
        eq(ancillaryDocumentReferences.sourceId, args.noteId),
        eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
      )).returning();
    if (updated.length !== 1) return { status: "sync_failed", retryRecorded: await recordSignatureSyncRetry(args.clinicId, args.ancillaryCaseId, args.noteId) };
    return { status: "synced" };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code != null && SIG_MIGRATION_CODES.has(code)) return { status: "migration_missing" };
    return { status: "sync_failed", retryRecorded: await recordSignatureSyncRetry(args.clinicId, args.ancillaryCaseId, args.noteId) };
  }
}
