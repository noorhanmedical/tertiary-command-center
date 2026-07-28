/**
 * Phase 2G — live canonical Billing Document orchestration boundary.
 *
 * Invoked AFTER a committed upstream change (Procedure Note signed/returned,
 * reference sync, required Order Note signature sync, report replacement,
 * procedure completion/invalidation, configured billing-requirement update). The
 * parent clinical action is ALWAYS already committed; this hook NEVER reverses
 * it. Re-evaluates the exact canonical readiness (superseding the prior snapshot),
 * supersedes a Billing Document whose evidence is no longer valid, creates/adopts
 * a pending document when ready, drives the generator when enabled, and propagates
 * the generator outcome TRUTHFULLY. A failure records durable PHI-free
 * reconciliation work; retry-persistence failure is surfaced. Flag-gated (OFF ⇒
 * zero migration-0055 reads/writes). Awaited — no fire-and-forget promise.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { billingDocumentRequests } from "@shared/schema/billingDocuments";
import { ancillaryDocumentReferences, BILLING_DOCUMENT_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";
import { billingReadinessRuntimeEnabled, billingDocumentRuntimeEnabled, featureFlags } from "../../lib/featureFlags";
import { evaluateCanonicalBillingReadiness, type BillingReadinessActor, type BillingReadinessOverride } from "./billingReadinessEvaluator";
import { createOrAdoptCanonicalBillingDocument, generateBillingDocument, currentBillingDocument, type GenerateBillingDocumentResult } from "./billingDocumentGenerator";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

export type EnsureBillingDocumentInput = {
  clinicId: number; ancillaryCaseId: number; actor?: BillingReadinessActor | null;
  source: string; override?: BillingReadinessOverride | null;
};

export type EnsureBillingDocumentResult = {
  status:
    | "skipped_flag_off" | "not_ready" | "missing_requirements" | "case_not_found"
    | "cross_clinic_denied" | "not_active" | "not_admin_approved" | "migration_missing"
    | "override_not_recorded" | "billing_document_pending" | "billing_document_generated"
    | "reconciliation_not_recorded" | "superseded_stale_document";
  readinessCheckId?: number;
  billingDocumentId?: number;
  generatorOutcome?: GenerateBillingDocumentResult["status"];
  generationDeferred?: boolean;
  generationRetryRecorded?: boolean;
  warnings?: string[];
};

export async function ensureCanonicalBillingDocumentForAncillaryCase(input: EnsureBillingDocumentInput): Promise<EnsureBillingDocumentResult> {
  if (!billingReadinessRuntimeEnabled()) return { status: "skipped_flag_off" };
  const warnings: string[] = [];
  try {
    const evalResult = await evaluateCanonicalBillingReadiness({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, actor: input.actor ?? null, source: input.source, override: input.override ?? null });
    switch (evalResult.status) {
      case "skipped_flag_off": return { status: "skipped_flag_off" };
      case "migration_missing": return { status: "migration_missing" };
      case "case_not_found": case "cross_clinic_denied": case "not_active": case "not_admin_approved": return { status: evalResult.status };
      case "override_not_recorded": return { status: "override_not_recorded", warnings: ["readiness_override_not_recorded"] };
      case "missing_requirements": {
        // Not (or no longer) ready — a stale current Billing Document whose evidence
        // no longer supports it must be superseded/voided (never silently kept).
        const superseded = await supersedeStaleBillingDocument(input, evalResult.evidenceFingerprint ?? null);
        if (superseded) return { status: "superseded_stale_document", readinessCheckId: evalResult.readinessCheckId };
        return { status: "missing_requirements", readinessCheckId: evalResult.readinessCheckId };
      }
      case "ready_to_generate": break;
      default: return { status: "not_ready", readinessCheckId: evalResult.readinessCheckId };
    }

    if (!billingDocumentRuntimeEnabled()) {
      // Readiness is ready, but the Billing Document runtime is OFF — do not create.
      return { status: "not_ready", readinessCheckId: evalResult.readinessCheckId, warnings: ["billing_document_runtime_off"] };
    }

    // Supersede a current document whose evidence version no longer matches.
    await supersedeStaleBillingDocument(input, evalResult.evidenceFingerprint ?? null);

    const created = await createOrAdoptCanonicalBillingDocument({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, source: input.source });
    if (created.status === "migration_missing") return { status: "migration_missing", readinessCheckId: evalResult.readinessCheckId };
    if (created.status !== "created" && created.status !== "reused") {
      return { status: "not_ready", readinessCheckId: evalResult.readinessCheckId, warnings: [`create_${created.status}`] };
    }
    const billingDocumentId = created.billingDocumentId!;

    // Drive the generator when enabled; otherwise queue an EXACT generate retry.
    let generatorOutcome: GenerateBillingDocumentResult["status"] | undefined;
    let generationDeferred: boolean | undefined;
    let generationRetryRecorded: boolean | undefined;
    if (featureFlags.billingDocumentGenerator) {
      try {
        const gr = await generateBillingDocument({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, billingDocumentId, source: input.source });
        generatorOutcome = gr.status;
        ({ generationDeferred, generationRetryRecorded } = classifyBillingGeneration(gr.status, warnings));
      } catch { generationDeferred = true; warnings.push("billing_generation_hook_threw"); }
    } else {
      // Generator flag OFF → queue exact generation work durably.
      generationRetryRecorded = await queueGenerate(input, billingDocumentId);
      generationDeferred = true;
      warnings.push(generationRetryRecorded ? "billing_generation_queued" : "reconciliation_not_recorded");
    }

    const status = generatorOutcome === "generated" ? "billing_document_generated" : "billing_document_pending";
    return { status, readinessCheckId: evalResult.readinessCheckId, billingDocumentId, generatorOutcome, generationDeferred: generationDeferred || undefined, generationRetryRecorded, warnings };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    // A durable retry keeps the readiness reconciliation recoverable.
    let recorded = false;
    try { await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "billing_document", requestedAction: "evaluate_billing_readiness", sourceSystem: input.source, errorCode: (e as { code?: string })?.code ?? "billing_hook_failed" }); recorded = true; } catch { recorded = false; }
    return { status: recorded ? "not_ready" : "reconciliation_not_recorded", warnings: ["billing_hook_failed"] };
  }
}

/** Classify a Billing Document generator outcome truthfully (never reverses the
 *  committed readiness). generationRetryRecorded=false ⇒ non-durable deferral. */
export function classifyBillingGeneration(outcome: GenerateBillingDocumentResult["status"], warnings: string[]): { generationDeferred: boolean | undefined; generationRetryRecorded: boolean | undefined } {
  switch (outcome) {
    case "generated": return { generationDeferred: undefined, generationRetryRecorded: undefined };
    case "generated_reference_retry_recorded": warnings.push("billing_reference_deferred"); return { generationDeferred: true, generationRetryRecorded: true };
    case "failed_retry_recorded": warnings.push("billing_generation_deferred"); return { generationDeferred: true, generationRetryRecorded: true };
    case "generated_reference_retry_not_recorded": case "failed_retry_not_recorded": warnings.push("reconciliation_not_recorded"); return { generationDeferred: true, generationRetryRecorded: false };
    case "already_generated": return { generationDeferred: undefined, generationRetryRecorded: undefined };
    default: warnings.push(`billing_generation_${outcome}`); return { generationDeferred: true, generationRetryRecorded: undefined };
  }
}

async function queueGenerate(input: EnsureBillingDocumentInput, billingDocumentId: number): Promise<boolean> {
  try { await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "billing_document", sourceTable: BILLING_DOCUMENT_SOURCE_TABLE, sourceId: billingDocumentId, requestedAction: "generate_billing_document", sourceSystem: input.source, errorCode: "billing_document_pending_generation" }); return true; }
  catch { return false; }
}

/**
 * Supersede/void the current canonical Billing Document when its evidence version
 * no longer matches the current readiness (procedure invalidation, report
 * replacement, requirement change). Signed/generated historical documents are
 * NEVER rewritten — only stamped superseded + their reference marked superseded.
 * Returns true iff a stale document was superseded.
 */
export async function supersedeStaleBillingDocument(input: { clinicId: number; ancillaryCaseId: number }, currentFingerprint: string | null): Promise<boolean> {
  const doc = await currentBillingDocument(input.clinicId, input.ancillaryCaseId);
  if (!doc) return false;
  // Keep the document if its evidence version still matches the current readiness.
  if (currentFingerprint != null && doc.evidenceFingerprint === currentFingerprint) return false;
  const now = new Date();
  const rows = await db.update(billingDocumentRequests)
    .set({ canonicalStatus: "superseded", supersededAt: now, updatedAt: now })
    .where(and(eq(billingDocumentRequests.id, doc.id), eq(billingDocumentRequests.clinicId, input.clinicId), eq(billingDocumentRequests.ancillaryCaseId, input.ancillaryCaseId), isNull(billingDocumentRequests.supersededAt)))
    .returning();
  if (rows.length !== 1) return false;
  // Supersede the exact reference too (best-effort; a missing ref is left for retry).
  await db.update(ancillaryDocumentReferences)
    .set({ documentStatus: "superseded", supersededAt: now, updatedAt: now })
    .where(and(eq(ancillaryDocumentReferences.sourceTable, BILLING_DOCUMENT_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, doc.id), eq(ancillaryDocumentReferences.documentKind, "billing_document"), eq(ancillaryDocumentReferences.clinicId, input.clinicId)));
  return true;
}
