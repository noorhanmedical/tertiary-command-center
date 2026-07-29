/**
 * Phase 2E — ancillary document reconciliation retry worker.
 *
 * Drains ancillary_document_reconciliation_failures. Background-job /
 * admin-CLI only — there is NO clinic-facing repair route. Bounded,
 * idempotent, PHI-free, never cross-clinic.
 */

import { featureFlags } from "../../lib/featureFlags";
import {
  listUnresolvedAncillaryDocumentFailures,
  recordAncillaryDocumentFailure,
  resolveAncillaryDocumentFailureById,
} from "../../repositories/ancillaryDocuments.repo";
import {
  PROCEDURE_EVENT_SOURCE_TABLE,
  PROCEDURE_NOTE_SOURCE_TABLE,
  type AncillaryDocumentReconciliationFailure,
} from "@shared/schema/ancillaryDocuments";
import { createOrReuseOrderNote, linkOrderNoteAdminReviewEvidence } from "./orderNoteService";
import { ensureAncillaryDocumentReference } from "./documentReferenceWriter";
import { createOrReuseProcedureNote, linkProcedureNoteEvidence, ensureProcedureNoteReferenceForNote, syncProcedureNoteReferenceSignature } from "../procedureLifecycle/procedureNoteService";
import { onProcedureCompleted, ensureCanonicalProcedureNoteForAncillaryCase } from "../procedureLifecycle/procedureLifecycleOrchestration";
import { generateProcedureNote, retryFailedProcedureNoteGeneration } from "../procedureLifecycle/procedureNoteGenerator";
import { voidProcedureNoteLineageForCase, reconcileVoidedProcedureNoteReference } from "../procedureLifecycle/procedureNoteLineage";
import { getProcedureNoteByIdForClinic } from "../../repositories/physicianPortal.repo";
import { featureFlags as flags, procedureNoteRuntimeEnabled, procedureNoteGeneratorEnabled } from "../../lib/featureFlags";
import {
  loadCanonicalDocumentSource,
  discoverCanonicalDocumentSource,
  resolveCaseForSource,
  ACTION_TO_KIND,
} from "./sourceAdapters";
import { isBillingRetryAction, retryBillingFailure } from "../billingLifecycle/billingRetryHandlers";

export type DocumentRetryStatus =
  | "resolved"
  | "still_deferred"
  | "not_yet_eligible"
  | "linked_waiting_for_note_runtime"
  | "signed_evidence_conflict"
  | "reference_missing"
  | "skipped"
  | "skipped_flag_off"
  | "retry_not_recorded"
  | "error"
  | "active_kind_conflict"
  | "source_not_found"
  | "source_type_mismatch"
  | "service_mismatch"
  | "case_mismatch"
  | "ownership_conflict"
  | "cross_clinic_denied"
  | "migration_missing";

export type DocumentRetryOutcome = {
  failureId: number;
  requestedAction: string;
  status: DocumentRetryStatus;
  message?: string;
};

const REFERENCE_ACTIONS = new Set(["link_report", "link_consent", "link_screening_form"]);

/**
 * A `created`/`reused` note whose clinical-body generator work deferred WITHOUT a
 * durable retry (generationRetryRecorded === false ⇒ reconciliation_not_recorded)
 * must NOT resolve the driving link/lineage failure — a later retry re-drives the
 * ensure and re-attempts generation until it succeeds or records a durable retry.
 * A fully-generated note, a durable deferral, or generation-suppressed/OFF is safe
 * to resolve (the note lineage itself is complete; generation is its own concern).
 */
function noteWorkFullyDurable(r: { generationDeferred?: boolean; generationRetryRecorded?: boolean }): boolean {
  return !(r.generationDeferred === true && r.generationRetryRecorded === false);
}

/**
 * Retry a source-bearing report/consent/screening_form reference link. Loads
 * the EXACT canonical source, validates ownership from the source's own
 * columns (never patient name/facility), re-drives the reference writer, and
 * resolves ONLY this exact failure id on created / reused_exact_source. An
 * active different-source slot conflict, a mismatch, or a missing source
 * leaves the failure UNRESOLVED with a structured status. Bounded, idempotent,
 * PHI-free.
 */
async function retryReferenceLink(
  failure: AncillaryDocumentReconciliationFailure,
): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };

  // Source-less failure → deterministic source discovery (never first/newest).
  let sourceTable = failure.sourceTable;
  let sourceId = failure.sourceId;
  if (sourceId == null) {
    const disc = await discoverCanonicalDocumentSource({
      requestedAction: failure.requestedAction,
      clinicId: failure.clinicId,
      ancillaryCaseId: failure.ancillaryCaseId,
      executionCaseId: failure.executionCaseId,
      patientScreeningId: failure.patientScreeningId,
    });
    if (!disc.ok) {
      const status: DocumentRetryStatus =
        disc.reason === "cross_clinic_denied" ? "cross_clinic_denied"
        : disc.reason === "service_mismatch" ? "service_mismatch"
        : disc.reason === "source_not_found" ? "source_not_found"
        : "still_deferred";
      return { ...base, status, message: disc.reason };
    }
    // Preserve the DISCOVERED source identity for the rest of the retry.
    sourceTable = disc.sourceTable;
    sourceId = disc.sourceId;
  }

  const loaded = await loadCanonicalDocumentSource(sourceTable, sourceId);
  if (!loaded.ok) {
    const status: DocumentRetryStatus =
      loaded.reason === "source_not_found" ? "source_not_found"
      : loaded.reason === "unsupported_source_table" ? "still_deferred"
      : "source_type_mismatch";
    return { ...base, status, message: loaded.reason };
  }
  const src = loaded.descriptor;

  // Cross-clinic: the source's own clinic must match the failure's clinic.
  if (src.clinicId == null || src.clinicId !== failure.clinicId) {
    return { ...base, status: "cross_clinic_denied", message: "cross_clinic_denied" };
  }
  // Document kind must map to the action AND the recorded failure kind.
  const expectedKind = ACTION_TO_KIND[failure.requestedAction];
  if (src.documentKind !== expectedKind) return { ...base, status: "source_type_mismatch", message: "action_kind_mismatch" };
  if (failure.documentKind != null && failure.documentKind !== src.documentKind) {
    return { ...base, status: "source_type_mismatch", message: "recorded_kind_mismatch" };
  }
  // Screening / execution recorded on the failure must match the source.
  if (failure.patientScreeningId != null && src.patientScreeningId != null && failure.patientScreeningId !== src.patientScreeningId) {
    return { ...base, status: "case_mismatch", message: "screening_mismatch" };
  }
  if (failure.executionCaseId != null && src.executionCaseId != null && failure.executionCaseId !== src.executionCaseId) {
    return { ...base, status: "case_mismatch", message: "execution_mismatch" };
  }

  // Deterministic case resolution — distinguishes service mismatch / ambiguity.
  const resolved = await resolveCaseForSource(src);
  if (resolved.kind !== "one") {
    if (resolved.kind === "service_mismatch") return { ...base, status: "service_mismatch", message: "service_mismatch" };
    return { ...base, status: "still_deferred", message: resolved.kind === "multiple_cases" ? "multiple_candidate_cases" : "no_candidate_case" };
  }
  // When the failure already names a case, it must match the resolved one.
  if (failure.ancillaryCaseId != null && failure.ancillaryCaseId !== resolved.case.id) {
    return { ...base, status: "case_mismatch", message: "ancillary_case_mismatch" };
  }

  const res = await ensureAncillaryDocumentReference({
    documentKind: src.documentKind,
    sourceTable: src.sourceTable,
    sourceId: src.sourceId,
    serviceType: src.serviceType,
    patientScreeningId: src.patientScreeningId,
    executionCaseId: src.executionCaseId,
    expectedClinicId: src.clinicId,
    documentStatus: src.documentStatus,
    signedAt: src.signedAt,
    // Preserve the source's own creation timestamp (never the retry time).
    actualCreatedAt: src.actualCreatedAt,
    downloadReference: src.downloadReference,
    source: "document_retry_worker",
  });
  switch (res.status) {
    case "created":
    case "reused_exact_source":
      // Resolve ONLY this exact failure id — never sibling source failures.
      await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
      return { ...base, status: "resolved" };
    case "active_kind_conflict":
      return { ...base, status: "active_kind_conflict", message: "active_kind_conflict" };
    case "cross_clinic_denied":
      return { ...base, status: "cross_clinic_denied" };
    case "migration_missing":
      return { ...base, status: "migration_missing" };
    case "skipped_flag_off":
      return { ...base, status: "skipped", message: "skipped_flag_off" };
    default:
      // deferred_ambiguous_case / deferred_reference / retry_not_recorded / failed
      return { ...base, status: "still_deferred", message: res.status };
  }
}

export async function retryAncillaryDocumentFailure(
  failure: AncillaryDocumentReconciliationFailure,
): Promise<DocumentRetryOutcome> {
  if (!featureFlags.unifiedAncillaryDocuments) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped" };
  }
  try {
    if (failure.requestedAction === "link_order_note" && failure.ancillaryCaseId != null) {
      const r = await createOrReuseOrderNote({
        clinicId: failure.clinicId,
        ancillaryCaseId: failure.ancillaryCaseId,
        source: "document_retry_worker",
      });
      if ((r.status === "created" || r.status === "reused") && !r.referenceDeferred) {
        // Resolve ONLY this exact failure row — never every row sharing
        // case + kind + action (sibling / different-source / different-clinic
        // link_order_note failures must stay open).
        await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
        return { failureId: failure.id, requestedAction: failure.requestedAction, status: "resolved" };
      }
      return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred", message: r.status };
    }
    if (failure.requestedAction === "link_order_note_evidence" && failure.ancillaryCaseId != null) {
      // Order Note already exists; only the immutable Admin Review evidence
      // link was deferred. Fully tenant-validated, atomic, LINK-ONLY retry —
      // never touches note body, signature, signedAt, or signer.
      const r = await linkOrderNoteAdminReviewEvidence({
        clinicId: failure.clinicId,
        ancillaryCaseId: failure.ancillaryCaseId,
        sourceId: failure.sourceId,
      });
      if (r.status === "skipped_flag_off") {
        return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped", message: r.status };
      }
      if (r.status === "linked") {
        // Resolve ONLY this exact failure row (idempotent), never every row
        // sharing case + kind + action — a sibling retry may still be open.
        await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
        return { failureId: failure.id, requestedAction: failure.requestedAction, status: "resolved" };
      }
      // still_deferred / cross_clinic_denied / note_case_mismatch /
      // note_not_found / reference_update_failed → keep the failure UNRESOLVED.
      return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred", message: r.status };
    }
    if (failure.requestedAction === "link_procedure_note") {
      return await retryProcedureNoteLink(failure);
    }
    if (failure.requestedAction === "link_procedure_note_evidence") {
      return await retryProcedureNoteEvidence(failure);
    }
    if (failure.requestedAction === "generate_procedure_note") {
      return await retryGenerateProcedureNote(failure);
    }
    if (failure.requestedAction === "reconcile_procedure_note_lineage") {
      return await retryProcedureNoteLineage(failure);
    }
    if (failure.requestedAction === "void_procedure_note") {
      return await retryVoidProcedureNote(failure);
    }
    if (failure.requestedAction === "sync_procedure_note_signature") {
      return await retryProcedureNoteSignatureSync(failure);
    }
    if (REFERENCE_ACTIONS.has(failure.requestedAction)) {
      return await retryReferenceLink(failure);
    }
    // ── Phase 2G canonical billing reconciliation actions ──
    if (isBillingRetryAction(failure.requestedAction)) {
      const r = await retryBillingFailure(failure);
      return { failureId: r.failureId, requestedAction: r.requestedAction, status: r.status as DocumentRetryStatus, message: r.message };
    }
    // create_reference / refresh_projection / supersede_reference are driven by
    // their originating source path — nothing safe to blindly re-drive here.
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped", message: "no_automatic_retry_for_action" };
  } catch (e) {
    try {
      await recordAncillaryDocumentFailure({
        clinicId: failure.clinicId,
        ancillaryCaseId: failure.ancillaryCaseId,
        patientScreeningId: failure.patientScreeningId,
        executionCaseId: failure.executionCaseId,
        documentKind: failure.documentKind,
        sourceTable: failure.sourceTable,
        sourceId: failure.sourceId,
        requestedAction: failure.requestedAction as never,
        sourceSystem: failure.sourceSystem ?? "document_retry_worker",
        errorCode: (e as { code?: string })?.code ?? "retry_failed",
      });
    } catch { /* ledger guard downstream */ }
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "error", message: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Retry a Procedure Note case-link failure. Three exact shapes:
 *   • sourceTable=procedure_events + sourceId → re-drive the completion hook
 *     (resolve/link the exact case, run the canonical ensure). Requires the
 *     lifecycle flag.
 *   • sourceTable=procedure_notes + sourceId → the note exists; re-create/reuse
 *     ONLY its exact reference via the case-scoped ensure. Requires the note flag.
 *   • source-less + ancillaryCaseId → rerun the centralized case-level ensure.
 * Resolves ONLY this exact failure id on complete success — never siblings.
 */
async function retryProcedureNoteLink(
  failure: AncillaryDocumentReconciliationFailure,
): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };

  // Procedure-event source → completion linkage + ensure. Pass the FAILURE's
  // clinic (never manufacture 0) and its case so clinic A cannot touch clinic B.
  if (failure.sourceTable === PROCEDURE_EVENT_SOURCE_TABLE && failure.sourceId != null) {
    if (!flags.canonicalProcedureLifecycle) return { ...base, status: "skipped_flag_off" };
    const r = await onProcedureCompleted({
      procedureEventId: failure.sourceId,
      expectedClinicId: failure.clinicId,
      expectedAncillaryCaseId: failure.ancillaryCaseId,
    });
    switch (r.status) {
      case "created": case "reused":
        // Note lineage complete. Resolve ONLY this exact failure id — unless the
        // generator deferred WITHOUT a durable retry (keep open so a later retry
        // re-drives generation and records/succeeds; never silently lose it).
        if (!noteWorkFullyDurable(r)) return { ...base, status: "still_deferred", message: "generation_reconciliation_not_recorded" };
        await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
        return { ...base, status: "resolved" };
      case "linked_pending_note":
        // Case linked but the Procedure Note runtime is OFF — NOT complete;
        // keep the failure unresolved so the note is created once runtime is ON.
        return { ...base, status: "linked_waiting_for_note_runtime" };
      case "not_yet_eligible": return { ...base, status: "not_yet_eligible", message: r.warnings[0] };
      case "ownership_conflict": case "identity_conflict": return { ...base, status: "ownership_conflict", message: r.status };
      case "cross_clinic_denied": return { ...base, status: "cross_clinic_denied" };
      case "unscoped_event": return { ...base, status: "still_deferred", message: "unscoped_event" };
      case "not_completed": return { ...base, status: "source_not_found", message: r.warnings[0] ?? "not_completed" };
      case "migration_missing": return { ...base, status: "migration_missing" };
      case "skipped_flag_off": return { ...base, status: "skipped_flag_off" };
      default: return { ...base, status: "still_deferred", message: r.status };
    }
  }

  // Exact note-source retry → reconcile ONLY that named note's exact reference.
  if (failure.sourceTable === PROCEDURE_NOTE_SOURCE_TABLE && failure.sourceId != null) {
    if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };
    if (!procedureNoteRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
    const r = await ensureProcedureNoteReferenceForNote({
      clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, noteId: failure.sourceId, source: "document_retry_worker",
    });
    switch (r.status) {
      case "resolved":
        await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
        return { ...base, status: "resolved" };
      case "source_not_found": return { ...base, status: "source_not_found" };
      case "note_case_mismatch": return { ...base, status: "case_mismatch" };
      case "cross_clinic_denied": return { ...base, status: "cross_clinic_denied" };
      case "source_type_mismatch": return { ...base, status: "source_type_mismatch" };
      case "migration_missing": return { ...base, status: "migration_missing" };
      default: return { ...base, status: "still_deferred" };
    }
  }

  // Source-less case-level → centralized case ensure (never first/newest).
  if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };
  if (!procedureNoteRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  const r = await createOrReuseProcedureNote({
    clinicId: failure.clinicId,
    ancillaryCaseId: failure.ancillaryCaseId,
    source: "document_retry_worker",
  });
  if ((r.status === "created" || r.status === "reused") && !r.referenceDeferred) {
    await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
    return { ...base, status: "resolved" };
  }
  if (r.status === "ineligible") return { ...base, status: "not_yet_eligible", message: r.eligibility.reasons[0] };
  if (r.status === "cross_clinic_denied") return { ...base, status: "cross_clinic_denied" };
  if (r.status === "skipped_flag_off") return { ...base, status: "skipped_flag_off" };
  return { ...base, status: "still_deferred", message: r.status };
}

/** Retry a Procedure Note evidence link — LINK-ONLY, signed-note-safe. */
async function retryProcedureNoteEvidence(
  failure: AncillaryDocumentReconciliationFailure,
): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  // Evidence is keyed to the exact post_procedure_note id (never procedure_events).
  if (failure.sourceTable != null && failure.sourceTable !== PROCEDURE_NOTE_SOURCE_TABLE) {
    return { ...base, status: "source_type_mismatch", message: "evidence_source_must_be_procedure_notes" };
  }
  const r = await linkProcedureNoteEvidence({
    clinicId: failure.clinicId,
    ancillaryCaseId: failure.ancillaryCaseId,
    sourceId: failure.sourceId,
  });
  switch (r.status) {
    case "linked":
      // Note + reference updated atomically → resolve ONLY this exact failure.
      await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
      return { ...base, status: "resolved" };
    case "skipped_flag_off": return { ...base, status: "skipped_flag_off" };
    case "not_yet_eligible": return { ...base, status: "not_yet_eligible" };
    case "signed_evidence_conflict": return { ...base, status: "signed_evidence_conflict" };
    case "reference_missing": return { ...base, status: "reference_missing" };
    case "cross_clinic_denied": return { ...base, status: "cross_clinic_denied" };
    case "note_case_mismatch": return { ...base, status: "case_mismatch" };
    case "source_not_found": return { ...base, status: "source_not_found" };
    case "source_type_mismatch": return { ...base, status: "source_type_mismatch" };
    case "migration_missing": return { ...base, status: "migration_missing" };
    default: return { ...base, status: "still_deferred" };
  }
}

/** §9 — run the generator for an EXACT pending note; resolve only on success. */
async function retryGenerateProcedureNote(failure: AncillaryDocumentReconciliationFailure): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!procedureNoteGeneratorEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null || failure.sourceId == null || failure.sourceTable !== PROCEDURE_NOTE_SOURCE_TABLE) return { ...base, status: "still_deferred", message: "invalid_source" };
  // Load the EXACT named note to choose the right (pending vs failed) entry point.
  const note = await getProcedureNoteByIdForClinic({ id: failure.sourceId, clinicId: failure.clinicId });
  if (!note) return { ...base, status: "source_not_found" };
  if (note.ancillaryCaseId !== failure.ancillaryCaseId) return { ...base, status: "case_mismatch" };
  // Superseded away (amended/voided) — generation is moot; lineage owns the
  // reference. Resolve this exact failure rather than looping forever.
  if (note.supersededAt != null) {
    await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
    return { ...base, status: "resolved" };
  }
  // Already generated — generation is COMPLETE, but the exact reference
  // projection may still be out of sync (§6). Synchronize it; resolve the
  // generation boundary only once the reference is synced OR a DISTINCT exact
  // reference retry is durably recorded (so the projection is never lost).
  if (note.generationStatus === "generated" || note.generationStatus === "approved") {
    const documentStatus = note.signatureStatus === "signed" ? "signed" as const : "pending_signature" as const;
    const sync = await syncProcedureNoteReferenceSignature({ clinicId: failure.clinicId, ancillaryCaseId: note.ancillaryCaseId ?? failure.ancillaryCaseId, noteId: note.id, documentStatus, signedAt: note.signedAt ?? null });
    if (sync.status === "synced") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
    if ((sync.status === "no_reference" || sync.status === "sync_failed") && sync.retryRecorded) { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
    if (sync.status === "migration_missing") return { ...base, status: "migration_missing" };
    // Projection incomplete and no separate retry persisted → keep this failure open.
    return { ...base, status: "still_deferred", message: `reference_${sync.status}` };
  }
  const args = { clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, noteId: failure.sourceId };
  const r = note.generationStatus === "failed"
    ? await retryFailedProcedureNoteGeneration({ ...args, failureId: failure.id })
    : await generateProcedureNote(args);
  // Resolve once the generation boundary is satisfied: the note is generated
  // (reference synced) OR generated with a DISTINCT reference retry recorded.
  if (r.status === "generated" || r.status === "generated_reference_retry_recorded") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (r.status === "cross_clinic_denied") return { ...base, status: "cross_clinic_denied" };
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  if (r.status === "skipped_flag_off") return { ...base, status: "skipped_flag_off" };
  if (r.status === "not_yet_eligible") return { ...base, status: "not_yet_eligible" };
  // generated_reference_retry_not_recorded, failed_retry_*, report_content_unavailable_*,
  // already_claimed, not_pending, failure_not_verified → NEVER resolve.
  return { ...base, status: "still_deferred", message: r.status };
}

/** §4/§9 — reconcile a Procedure Note lineage failure.
 *   • SOURCE-BEARING (procedure_notes + sourceId) → require the EXACT named note,
 *     validate clinic/case/type, confirm it is a lineage node for the case, then
 *     re-drive the case ensure (which supersedes + amends on report change) to
 *     reconcile ONLY that case's lineage. NEVER silently broadened.
 *   • SOURCE-LESS (sourceTable null) → case-level ensure.
 *   • procedure_notes + null sourceId is an INVALID pairing → never processed.
 *  Resolves ONLY this exact failure id on complete success. */
async function retryProcedureNoteLineage(failure: AncillaryDocumentReconciliationFailure): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!procedureNoteRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };

  // Source-bearing → bind to the EXACT named lineage note before reconciling.
  if (failure.sourceTable === PROCEDURE_NOTE_SOURCE_TABLE) {
    if (failure.sourceId == null) return { ...base, status: "still_deferred", message: "invalid_source_pairing" };
    const note = await getProcedureNoteByIdForClinic({ id: failure.sourceId, clinicId: failure.clinicId });
    if (!note) return { ...base, status: "source_not_found" };
    if (note.ancillaryCaseId !== failure.ancillaryCaseId) return { ...base, status: "case_mismatch" };
    if (note.noteType !== "post_procedure_note") return { ...base, status: "source_type_mismatch" };
    // `note` is a post_procedure_note for the exact case — a genuine lineage node
    // (current stale note or a superseded predecessor). Re-driving the case-scoped
    // ensure reconciles exactly this lineage (service is validated within ensure).
  } else if (failure.sourceTable != null) {
    // Lineage work is only ever keyed to procedure_notes (or source-less).
    return { ...base, status: "source_type_mismatch", message: "lineage_source_must_be_procedure_notes" };
  }

  const r = await ensureCanonicalProcedureNoteForAncillaryCase({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, source: "document_retry_worker" });
  if (r.status === "created" || r.status === "reused") {
    // Non-durable generator deferral → keep open so a later retry re-drives it.
    if (!noteWorkFullyDurable(r)) return { ...base, status: "still_deferred", message: "generation_reconciliation_not_recorded" };
    await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" };
  }
  if (r.status === "cross_clinic_denied") return { ...base, status: "cross_clinic_denied" };
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  if (r.status === "skipped_flag_off") return { ...base, status: "skipped_flag_off" };
  if (r.status === "not_yet_eligible") return { ...base, status: "not_yet_eligible" };
  return { ...base, status: "still_deferred", message: r.status };
}

/** §4/§9 — void reconciliation. A SOURCE-BEARING failure reconciles the EXACT
 *  named (superseded/voided) note's reference and NEVER resolves on
 *  reference_missing / source no_current_note. A SOURCE-LESS case-level failure
 *  may idempotently resolve on no_current_note. */
async function retryVoidProcedureNote(failure: AncillaryDocumentReconciliationFailure): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!procedureNoteRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };

  // Source-bearing → exact reference reconciliation on the named note.
  if (failure.sourceTable === PROCEDURE_NOTE_SOURCE_TABLE && failure.sourceId != null) {
    const r = await reconcileVoidedProcedureNoteReference({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, noteId: failure.sourceId });
    if (r.status === "reconciled" || r.status === "already_reconciled") {
      await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
      return { ...base, status: "resolved" };
    }
    if (r.status === "reference_missing") return { ...base, status: "reference_missing" };
    if (r.status === "source_not_found") return { ...base, status: "source_not_found" };
    if (r.status === "ownership_conflict") return { ...base, status: "ownership_conflict" };
    if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
    // §3 — no terminal procedure invalidation (e.g. amendment-superseded note):
    // NEVER resolve; the reference must not be voided without terminal evidence.
    if (r.status === "terminal_evidence_missing") return { ...base, status: "still_deferred", message: "terminal_evidence_missing" };
    return { ...base, status: "still_deferred", message: r.status };
  }

  // Source-less case-level → idempotent lineage void.
  const r = await voidProcedureNoteLineageForCase({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, reason: "retry_void", actorUserId: null });
  if (r.status === "voided" || r.status === "voided_retry_recorded" || r.status === "no_current_note") {
    await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
    return { ...base, status: "resolved" };
  }
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  if (r.status === "skipped_flag_off") return { ...base, status: "skipped_flag_off" };
  return { ...base, status: "still_deferred", message: r.status };
}

/** §9 — mirror an exact note's current signature onto its exact reference. */
async function retryProcedureNoteSignatureSync(failure: AncillaryDocumentReconciliationFailure): Promise<DocumentRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!procedureNoteRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.sourceId == null || failure.sourceTable !== PROCEDURE_NOTE_SOURCE_TABLE) return { ...base, status: "still_deferred", message: "invalid_source" };
  const note = await getProcedureNoteByIdForClinic({ id: failure.sourceId, clinicId: failure.clinicId });
  if (!note) return { ...base, status: "source_not_found" };
  const documentStatus = note.signatureStatus === "signed" ? "signed" as const : "pending_signature" as const;
  const r = await syncProcedureNoteReferenceSignature({ clinicId: failure.clinicId, ancillaryCaseId: note.ancillaryCaseId ?? null, noteId: note.id, documentStatus, signedAt: note.signedAt ?? null });
  if (r.status === "synced") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (r.status === "cross_clinic_denied") return { ...base, status: "cross_clinic_denied" };
  if (r.status === "case_mismatch") return { ...base, status: "case_mismatch" };
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  if (r.status === "skipped_flag_off") return { ...base, status: "skipped_flag_off" };
  if (r.status === "no_reference") return { ...base, status: "reference_missing" };
  return { ...base, status: "still_deferred" };
}

export async function retryUnresolvedAncillaryDocumentFailures(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<{ processed: number; outcomes: DocumentRetryOutcome[] }> {
  if (!featureFlags.unifiedAncillaryDocuments) return { processed: 0, outcomes: [] };
  const rows = await listUnresolvedAncillaryDocumentFailures({ clinicId: args?.clinicId, limit: args?.limit ?? 100 });
  const outcomes: DocumentRetryOutcome[] = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await retryAncillaryDocumentFailure(row));
  }
  return { processed: rows.length, outcomes };
}
