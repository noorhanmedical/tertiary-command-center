/**
 * Phase 2E-B — the ONE live orchestration boundary for canonical Order Note
 * creation/reuse.
 *
 * Live workflows (service-specific Admin Review approval, canonical ancillary
 * appointment scheduled/completed) call this AFTER their own state change has
 * already committed. It delegates all eligibility to the existing
 * createOrReuseOrderNote (the two-condition rule lives there, not here), maps
 * the outcome to a truthful writer contract, and — critically — NEVER throws:
 * a hook failure must never reverse the parent's already-committed
 * transaction. On failure it records durable, PHI-free reconciliation work.
 */

import { featureFlags } from "../../lib/featureFlags";
import { createOrReuseOrderNote } from "./orderNoteService";
import { recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";
import { ORDER_NOTE_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";

export type OrderNoteHookStatus =
  | "skipped_flag_off"
  | "not_yet_eligible"
  | "created"
  | "reused"
  | "deferred_reference"
  | "deferred_evidence"
  | "reconciliation_not_recorded"
  | "migration_missing"
  | "failed";

export type OrderNoteHookResult = {
  status: OrderNoteHookStatus;
  ancillaryCaseId: number;
  orderNoteId?: number;
  warnings: string[];
};

export type EnsureOrderNoteInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  source: string;
};

async function recordHookRetry(input: EnsureOrderNoteInput, errorCode: string): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      documentKind: "order_note",
      sourceTable: ORDER_NOTE_SOURCE_TABLE,
      requestedAction: "link_order_note",
      sourceSystem: input.source,
      errorCode,
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "order_note_hook_retry_record_failed",
      clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId,
      code: (e as { code?: string })?.code ?? "ledger_write_failed",
    }));
    return false;
  }
}

export async function ensureCanonicalOrderNoteForAncillaryCase(
  input: EnsureOrderNoteInput,
): Promise<OrderNoteHookResult> {
  // Fast, zero-IO exit when the canonical Order Note flow is disabled. The
  // service also guards, but short-circuiting here keeps the contract crisp.
  if (!featureFlags.canonicalOrderNote) {
    return { status: "skipped_flag_off", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
  }
  try {
    const r = await createOrReuseOrderNote({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
    });
    switch (r.status) {
      case "skipped_flag_off":
        return { status: "skipped_flag_off", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
      case "ineligible":
        // The two-condition boundary is not yet satisfied (approval OR a
        // qualifying appointment still missing). Truthful, not a failure.
        return { status: "not_yet_eligible", ancillaryCaseId: input.ancillaryCaseId, warnings: r.eligibility.reasons };
      case "case_not_found":
      case "cross_clinic_denied": {
        // Should be unreachable from a just-committed same-clinic case.
        const recorded = await recordHookRetry(input, r.status);
        return {
          status: recorded ? "failed" : "reconciliation_not_recorded",
          ancillaryCaseId: input.ancillaryCaseId, warnings: [r.status],
        };
      }
      case "deferred_legacy_ambiguous":
        // A durable retry was already recorded inside createOrReuseOrderNote.
        return { status: "deferred_reference", ancillaryCaseId: input.ancillaryCaseId, warnings: [r.reason] };
      case "created":
      case "reused": {
        let status: OrderNoteHookStatus = r.status;
        if (r.referenceDeferred) status = "deferred_reference";
        else if (r.adminReviewEvidenceDeferred && !r.adminReviewEvidenceRetryRecorded) status = "reconciliation_not_recorded";
        else if (r.adminReviewEvidenceDeferred) status = "deferred_evidence";
        return { status, orderNoteId: r.orderNoteId, ancillaryCaseId: input.ancillaryCaseId, warnings: r.warnings };
      }
      default: {
        const recorded = await recordHookRetry(input, "order_note_unexpected_status");
        return { status: recorded ? "failed" : "reconciliation_not_recorded", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
      }
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "ANCILLARY_DOCUMENT_MIGRATION_MISSING") {
      return { status: "migration_missing", ancillaryCaseId: input.ancillaryCaseId, warnings: ["migration_missing"] };
    }
    const recorded = await recordHookRetry(input, code ?? "order_note_hook_failed");
    return {
      status: recorded ? "failed" : "reconciliation_not_recorded",
      ancillaryCaseId: input.ancillaryCaseId, warnings: [],
    };
  }
}
