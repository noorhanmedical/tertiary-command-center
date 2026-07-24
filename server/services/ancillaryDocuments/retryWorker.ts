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
  resolveAncillaryDocumentFailure,
  resolveAncillaryDocumentFailureById,
} from "../../repositories/ancillaryDocuments.repo";
import type { AncillaryDocumentReconciliationFailure } from "@shared/schema/ancillaryDocuments";
import { createOrReuseOrderNote, linkOrderNoteAdminReviewEvidence } from "./orderNoteService";

export type DocumentRetryOutcome = {
  failureId: number;
  requestedAction: string;
  status: "resolved" | "still_deferred" | "skipped" | "error";
  message?: string;
};

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
        await resolveAncillaryDocumentFailure({
          ancillaryCaseId: failure.ancillaryCaseId,
          documentKind: "order_note",
          requestedAction: "link_order_note",
        });
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
    // create_reference / refresh_projection / link_report / link_consent /
    // link_screening_form / supersede_reference are driven by their
    // originating source path — nothing safe to blindly re-drive here.
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
