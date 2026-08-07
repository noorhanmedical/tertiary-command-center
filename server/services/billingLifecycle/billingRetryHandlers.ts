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
import { canonicalBillingDocumentRequests as billingDocumentRequests } from "@shared/schema/billingDocuments";
import { BILLING_DOCUMENT_SOURCE_TABLE, type AncillaryDocumentReconciliationFailure } from "@shared/schema/ancillaryDocuments";
import { resolveAncillaryDocumentFailureById } from "../../repositories/ancillaryDocuments.repo";
import { procedureNoteRuntimeEnabled, billingReadinessRuntimeEnabled, billingDocumentRuntimeEnabled, billingDocumentGeneratorEnabled } from "../../lib/featureFlags";
import { evaluateCanonicalBillingReadiness } from "./billingReadinessEvaluator";
import { generateBillingDocument, retryFailedBillingDocumentGeneration, syncBillingDocumentReference, projectExactBillingDocumentReference, ensureBillingReferenceDurability } from "./billingDocumentGenerator";
import { supersedeStaleBillingDocument, billingReferenceSupersessionDurable } from "./billingLifecycleOrchestration";

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
    case "link_billing_document": return retryLinkReference(failure);
    case "sync_billing_document_reference": return retrySyncReference(failure);
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
  // Superseded/voided → generation is moot; no reference is needed for a
  // superseded document. Resolve the exact failure.
  if (doc.supersededAt != null || doc.canonicalStatus === "superseded" || doc.canonicalStatus === "voided") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  // §2 — a generated/approved document may resolve ONLY after an EXACT
  // reference-durability check (reference present OR a durable link retry).
  if (doc.canonicalStatus === "generated" || doc.canonicalStatus === "approved") return resolveIfReferenceDurable(failure);
  const args = { clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, billingDocumentId: failure.sourceId, source: "billing_retry_worker" };
  const r = doc.canonicalStatus === "failed" ? await retryFailedBillingDocumentGeneration({ ...args, failureId: failure.id }) : await generateBillingDocument(args);
  // A fresh finalize established durability (reference created, or a link retry
  // recorded) — safe to resolve.
  if (r.status === "generated" || r.status === "generated_reference_retry_recorded") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  // A concurrently-generated document must go through the same durability check.
  if (r.status === "already_generated") return resolveIfReferenceDurable(failure);
  if (r.status === "migration_missing") return { ...base, status: "migration_missing" };
  // generated_reference_retry_not_recorded / stale_readiness / not_ready /
  // already_claimed / failed_retry_* / failure_not_verified → NEVER resolve.
  return { ...base, status: "still_deferred", message: r.status };
}

/** §2 — resolve the exact generate failure ONLY when the reference is durably
 *  recoverable: the exact reference is present, OR a distinct link_billing_document
 *  recovery failure is durably recorded. Otherwise keep it OPEN. */
async function resolveIfReferenceDurable(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  // ancillaryCaseId + sourceId are guaranteed non-null by retryGenerateDocument's guard.
  const d = await ensureBillingReferenceDurability({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId!, billingDocumentId: failure.sourceId!, source: "billing_retry_worker" });
  if (d === "reference_present" || d === "link_retry_recorded") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (d === "ownership_conflict") return { ...base, status: "ownership_conflict" };
  if (d === "duplicate_current_reference") return { ...base, status: "reference_conflict", message: "duplicate_current_reference" };
  if (d === "migration_missing") return { ...base, status: "migration_missing" };
  // link_retry_not_recorded — missing reference AND no durable recovery → keep open.
  return { ...base, status: "reference_missing", message: "reference_retry_not_recorded" };
}

/** §5B — link_billing_document CREATES the missing exact reference via the
 *  executable projection. Resolves ONLY after projected/already_projected;
 *  ownership_conflict / not_projectable / source_not_found / retry_not_recorded
 *  remain unresolved. */
async function retryLinkReference(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!billingDocumentRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null || failure.sourceId == null || failure.sourceTable !== BILLING_DOCUMENT_SOURCE_TABLE) return { ...base, status: "still_deferred", message: "invalid_source" };
  const r = await projectExactBillingDocumentReference({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, billingDocumentId: failure.sourceId, source: "billing_retry_worker" });
  if (r === "projected" || r === "already_projected") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  if (r === "source_not_found") return { ...base, status: "source_not_found" };
  if (r === "ownership_conflict") return { ...base, status: "ownership_conflict" };
  if (r === "migration_missing") return { ...base, status: "migration_missing" };
  // stale_readiness / not_projectable / retry_recorded / retry_not_recorded → never resolve.
  return { ...base, status: "still_deferred", message: r };
}

/** §5C — sync_billing_document_reference ONLY updates an EXISTING reference's
 *  status. It never creates a missing reference (that stays link_billing_document).
 *  Resolves only on synced. */
async function retrySyncReference(failure: AncillaryDocumentReconciliationFailure): Promise<BillingRetryOutcome> {
  const base = { failureId: failure.id, requestedAction: failure.requestedAction };
  if (!billingDocumentRuntimeEnabled()) return { ...base, status: "skipped_flag_off" };
  if (failure.ancillaryCaseId == null || failure.sourceId == null || failure.sourceTable !== BILLING_DOCUMENT_SOURCE_TABLE) return { ...base, status: "still_deferred", message: "invalid_source" };
  const [doc] = await db.select().from(billingDocumentRequests).where(eq(billingDocumentRequests.id, failure.sourceId)).limit(1);
  if (!doc) return { ...base, status: "source_not_found" };
  if (doc.clinicId !== failure.clinicId || doc.ancillaryCaseId !== failure.ancillaryCaseId) return { ...base, status: "ownership_conflict" };
  const status = doc.canonicalStatus === "generated" ? "generated" : (doc.canonicalStatus ?? "pending");
  const r = await syncBillingDocumentReference({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId, billingDocumentId: failure.sourceId, documentStatus: status, source: "billing_retry_worker" });
  if (r === "synced") { await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId }); return { ...base, status: "resolved" }; }
  // reference_missing (needs link) / retry_recorded / retry_not_recorded → never resolve.
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
  // K8: resolve ONLY on a COMMITTED re-evaluation. A transient status (e.g.
  // requirements_unavailable_retry_recorded / override_not_recorded / tenancy) leaves
  // the retry UNRESOLVED — the post-condition cannot be proven from a transient read.
  if (evalResult.status !== "ready_to_generate" && evalResult.status !== "missing_requirements") return { ...base, status: "still_deferred", message: evalResult.status };
  const superseded = await supersedeStaleBillingDocument({ clinicId: failure.clinicId, ancillaryCaseId: failure.ancillaryCaseId }, evalResult.evidenceFingerprint ?? null);
  // K8 post-condition: resolve ONLY when reference supersession is DURABLE (no current
  // reference points at a superseded document). Otherwise keep the exact retry OPEN.
  if (!(await billingReferenceSupersessionDurable(failure.clinicId, failure.ancillaryCaseId))) return { ...base, status: "still_deferred", message: "reference_supersession_deferred" };
  await resolveAncillaryDocumentFailureById({ id: failure.id, clinicId: failure.clinicId });
  return { ...base, status: "resolved", message: superseded ? "superseded" : "no_stale_document" };
}
