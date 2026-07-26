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
import { createOrReuseProcedureNote, linkProcedureNoteEvidence } from "../procedureLifecycle/procedureNoteService";
import { onProcedureCompleted } from "../procedureLifecycle/procedureLifecycleOrchestration";
import { featureFlags as flags } from "../../lib/featureFlags";
import {
  loadCanonicalDocumentSource,
  discoverCanonicalDocumentSource,
  resolveCaseForSource,
  ACTION_TO_KIND,
} from "./sourceAdapters";

export type DocumentRetryStatus =
  | "resolved"
  | "still_deferred"
  | "not_yet_eligible"
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
    if (REFERENCE_ACTIONS.has(failure.requestedAction)) {
      return await retryReferenceLink(failure);
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

  // Procedure-event source → completion linkage + ensure.
  if (failure.sourceTable === PROCEDURE_EVENT_SOURCE_TABLE && failure.sourceId != null) {
    if (!flags.canonicalProcedureLifecycle) return { ...base, status: "skipped_flag_off" };
    const r = await onProcedureCompleted(failure.sourceId);
    switch (r.status) {
      case "created": case "reused": case "linked_pending_note":
        await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
        return { ...base, status: "resolved" };
      case "not_yet_eligible": return { ...base, status: "not_yet_eligible", message: r.warnings[0] };
      case "ownership_conflict": return { ...base, status: "ownership_conflict" };
      case "cross_clinic_denied": return { ...base, status: "cross_clinic_denied" };
      case "migration_missing": return { ...base, status: "migration_missing" };
      case "skipped_flag_off": return { ...base, status: "skipped_flag_off" };
      case "deferred_reference": return { ...base, status: "still_deferred", message: "deferred_reference" };
      default: return { ...base, status: "still_deferred", message: r.status };
    }
  }

  // Note source OR source-less case-level → centralized case ensure.
  if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };
  if (!flags.canonicalProcedureNote) return { ...base, status: "skipped_flag_off" };
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
      await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
      return { ...base, status: "resolved" };
    case "skipped_flag_off": return { ...base, status: "skipped_flag_off" };
    case "not_yet_eligible": return { ...base, status: "not_yet_eligible" };
    case "cross_clinic_denied": return { ...base, status: "cross_clinic_denied" };
    case "note_case_mismatch": return { ...base, status: "case_mismatch" };
    case "source_not_found": return { ...base, status: "source_not_found" };
    case "source_type_mismatch": return { ...base, status: "source_type_mismatch" };
    default: return { ...base, status: "still_deferred" };
  }
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
