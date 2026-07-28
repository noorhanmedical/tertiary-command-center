/**
 * Phase 2G — canonical billing reconciliation retry handlers.
 *
 * Background-job / admin-CLI only (no clinic-facing repair route). Each handler
 * resolves ONLY its exact failure id (never broad case/action resolution), never
 * resolves a partial success / retry_not_recorded / missing-exact-evidence /
 * stale-readiness / cross-clinic-case-service conflict, and is PHI-free.
 */

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { billingDocumentRequests } from "@shared/schema/billingDocuments";
import { BILLING_DOCUMENT_SOURCE_TABLE, type AncillaryDocumentReconciliationFailure } from "@shared/schema/ancillaryDocuments";
import { resolveAncillaryDocumentFailureById } from "../../repositories/ancillaryDocuments.repo";
import { procedureNoteRuntimeEnabled, billingReadinessRuntimeEnabled, billingDocumentRuntimeEnabled, billingDocumentGeneratorEnabled } from "../../lib/featureFlags";
import { evaluateCanonicalBillingReadiness } from "./billingReadinessEvaluator";
import { generateBillingDocument, retryFailedBillingDocumentGeneration, syncBillingDocumentReference, createOrAdoptCanonicalBillingDocument } from "./billingDocumentGenerator";
import { supersedeStaleBillingDocument } from "./billingLifecycleOrchestration";

// Mirror of the worker's outcome shape (kept structural to avoid a cross-import).
export type BillingRetryOutcome = { failureId: number; requestedAction: string; status: string; message?: string };

const BILLING_RETRY_ACTIONS = new Set([
  "evaluate_billing_readiness", "generate_billing_document", "link_billing_document",
  "supersede_billing_document", "sync_billing_document_reference",
]);

export function isBillingRetryAction(action: string): boolean {
  return BILLING_RETRY_ACTIONS.has(action);
}

/** Dispatch a Phase 2G billing reconciliation failure to its exact handler. */
export async function retryBillingFailure(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  switch (failure.requestedAction) {
    case "evaluate_billing_readiness": return retryEvaluateReadiness(failure);
    case "generate_billing_document": return retryGenerateDocument(failure);
    case "link_billing_document": return retrySyncReference(failure, "link_billing_document");
    case "sync_billing_document_reference": return retrySyncReference(failure, "sync_billing_document_reference");
    case "supersede_billing_document": return retrySupersede(failure);
    default: return { ...base, status: "skipped", message: "no_billing_retry_for_action" };
  }
}

async function retryEvaluateReadiness(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!billingReadinessRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };
  const r = await evaluateCanonicalBillingReadiness({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, source: "billing_retry_worker" });
  // A committed evaluation (ready or missing) resolves the eval failure; a
  // migration/override-not-recorded/tenancy result never resolves.
  if (r.status === "ready_to_generate" || r.status === "missing_requirements") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  return { ...base, status: "still_deferred", message: r.status };
}

async function retryGenerateDocument(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!billingDocumentGeneratorEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null || failure.sourceId == null || failure.sourceTable !== BILLING_DOCUMENT_SOURCE_TABLE) return { ...base, status: "still_deferred", message: "invalid_source" };
  const [doc] = await db.select().from(billingDocumentRequests).where(eq(billingDocumentRequests.id, failure.sourceId)).limit(1);
  if (!doc) return { ...base, status: "source_not_found" };
  if (doc.clinicId !== failure.clinicId || doc.ancillaryCaseId !== failure.ancillaryCaseId) return { ...base, status: "ownership_conflict" };
  if (doc.canonicalStatus === "generated" || doc.canonicalStatus === "approved") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (doc.supersededAt != null || doc.canonicalStatus === "superseded" || doc.canonicalStatus === "voided") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  const args = { clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, billingDocumentId: failure.sourceId, source: "billing_retry_worker" };
  const r = doc.canonicalStatus === "failed" ? await retryFailedBillingDocumentGeneration({ ...args, failureId: failure.id }) : await generateBillingDocument(args);
  if (r.status === "generated" || r.status === "generated_reference_retry_recorded" || r.status === "already_generated") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  // stale_readiness / not_ready / already_claimed / failed_retry_* / failure_not_verified → NEVER resolve.
  return { ...base, status: "still_deferred", message: r.status };
}

async function retrySyncReference(failure: AncillaryDocumentReconciliationFailure, action: string): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!billingDocumentRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null || failure.sourceId == null || failure.sourceTable !== BILLING_DOCUMENT_SOURCE_TABLE) return { ...base, status: "still_deferred", message: "invalid_source" };
  const [doc] = await db.select().from(billingDocumentRequests).where(eq(billingDocumentRequests.id, failure.sourceId)).limit(1);
  if (!doc) return { ...base, status: "source_not_found" };
  if (doc.clinicId !== failure.clinicId || doc.ancillaryCaseId !== failure.ancillaryCaseId) return { ...base, status: "ownership_conflict" };
  // link_billing_document (re)creates a missing reference via create/adopt then sync;
  // sync_billing_document_reference only mirrors status onto the exact reference.
  if (action === "link_billing_document" && doc.canonicalStatus === "generated") {
    await createOrAdoptCanonicalBillingDocument({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, source: "billing_retry_worker" });
  }
  const status = doc.canonicalStatus === "generated" ? "generated" : (doc.canonicalStatus ?? "pending");
  const r = await syncBillingDocumentReference({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, billingDocumentId: failure.sourceId, documentStatus: status, source: "billing_retry_worker" });
  if (r === "synced") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  // retry_recorded / retry_not_recorded (reference still missing) → never resolve.
  return { ...base, status: "reference_missing", message: r };
}

async function retrySupersede(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!procedureNoteRuntimeEnabled() || !billingDocumentRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null) return { ...base, status: "still_deferred", message: "missing_ancillary_case" };
  // Re-evaluate to establish the CURRENT evidence version, then supersede any
  // current document whose evidence no longer matches.
  const evalResult = await evaluateCanonicalBillingReadiness({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, source: "billing_retry_worker" });
  if (evalResult.status === "migration_missing") return { ...base, status: "migration_missing" };
  const superseded = await supersedeStaleBillingDocument({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId }, evalResult.evidenceFingerprint ?? null);
  // Resolve whether or not a stale doc existed — the invariant (no stale current
  // doc for changed evidence) now holds either way.
  await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
  return { ...base, status: superseded ? "resolved" : "resolved", message: superseded ? "superseded" : "no_stale_document" };
}
