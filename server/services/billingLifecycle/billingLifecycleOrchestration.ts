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
import { and, eq, isNull, inArray } from "drizzle-orm";
import { canonicalBillingDocumentRequests as billingDocumentRequests } from "@shared/schema/billingDocuments";
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

/**
 * §6 — the SINGLE live wiring entry invoked AFTER a committed upstream boundary
 * (Procedure Note sign/return, report replacement, procedure completion, terminal
 * procedure transition). Flag-gated FIRST (OFF ⇒ zero migration-0055 reads/writes;
 * the committed parent is untouched), exact clinic + case only, awaited, and
 * NON-THROWING — a billing-hook failure never reverses the parent clinical action
 * (its own durable ledger covers reconciliation). No override is ever applied
 * through this path (overrides are explicit-API only).
 */
export async function triggerBillingReadinessForCommittedCase(input: { clinicId: number | null; ancillaryCaseId: number | null; source: string }): Promise<EnsureBillingDocumentResult | null> {
  if (!billingReadinessRuntimeEnabled()) return null;
  if (input.clinicId == null || input.ancillaryCaseId == null) return null;
  try {
    return await ensureCanonicalBillingDocumentForAncillaryCase({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, actor: null, source: input.source });
  } catch { return null; }
}

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
        const sup = await supersedeStaleBillingDocument(input, evalResult.evidenceFingerprint ?? null);
        if (supersedeDidSupersede(sup)) return { status: "superseded_stale_document", readinessCheckId: evalResult.readinessCheckId, ...(sup.status === "superseded_reference_not_durable" ? { warnings: ["reconciliation_not_recorded"] } : {}) };
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
/** K7: a TRUTHFUL structured supersession result — the bare boolean overstated
 *  durability (it returned `true` even when reference supersession AND the retry-record
 *  both failed). Callers must be able to distinguish a durable supersession from one
 *  whose reference reconciliation could not be persisted. */
export type SupersedeBillingDocumentResult =
  | { status: "not_stale" }
  | { status: "superseded"; billingDocumentId: number; referenceDurable: true; retryRecorded: false }
  | { status: "superseded_reference_retry_recorded"; billingDocumentId: number; referenceDurable: false; retryRecorded: true }
  | { status: "superseded_reference_not_durable"; billingDocumentId: number; referenceDurable: false; retryRecorded: false }
  | { status: "conflict" };

/** True iff the result superseded a stale document (any reference-durability variant). */
export function supersedeDidSupersede(r: SupersedeBillingDocumentResult): boolean {
  return r.status === "superseded" || r.status === "superseded_reference_retry_recorded" || r.status === "superseded_reference_not_durable";
}

export async function supersedeStaleBillingDocument(input: { clinicId: number; ancillaryCaseId: number }, currentFingerprint: string | null): Promise<SupersedeBillingDocumentResult> {
  const doc = await currentBillingDocument(input.clinicId, input.ancillaryCaseId);
  if (!doc) return { status: "not_stale" };
  // Keep the document if its evidence version still matches the current readiness.
  if (currentFingerprint != null && doc.evidenceFingerprint === currentFingerprint) return { status: "not_stale" };
  const now = new Date();
  const rows = await db.update(billingDocumentRequests)
    .set({ canonicalStatus: "superseded", supersededAt: now, updatedAt: now })
    .where(and(eq(billingDocumentRequests.id, doc.id), eq(billingDocumentRequests.clinicId, input.clinicId), eq(billingDocumentRequests.ancillaryCaseId, input.ancillaryCaseId), isNull(billingDocumentRequests.supersededAt)))
    .returning();
  if (rows.length !== 1) return { status: "conflict" };
  // K7: DURABLE reference supersession. Supersede the exact current reference; if the
  // update fails OR a current (non-superseded) reference still remains for this now-
  // superseded document, record an exact `supersede_billing_document` retry. The
  // document ROW stays superseded regardless (fail-closed), but the RESULT tells the
  // truth: durable, retry-recorded, or not-durable-and-not-recorded (never a clean lie).
  let referenceDurable = false;
  let retryRecorded = false;
  try {
    // Supersede ONLY this exact case's current reference — a malformed same-source
    // reference belonging to ANOTHER case must never be mutated by this case's supersession.
    await db.update(ancillaryDocumentReferences)
      .set({ documentStatus: "superseded", supersededAt: now, updatedAt: now })
      .where(and(eq(ancillaryDocumentReferences.sourceTable, BILLING_DOCUMENT_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, doc.id), eq(ancillaryDocumentReferences.documentKind, "billing_document"), eq(ancillaryDocumentReferences.clinicId, input.clinicId), eq(ancillaryDocumentReferences.ancillaryCaseId, input.ancillaryCaseId), isNull(ancillaryDocumentReferences.supersededAt)));
    // Prove durability via the exact-source post-condition: RAW-truncation-safe, and a
    // wrong-case same-source current reference is an integrity conflict → non-durable
    // (never a clean `superseded` result while a foreign-case reference remains current).
    referenceDurable = await billingReferenceSupersessionDurableForDocument(input.clinicId, input.ancillaryCaseId, doc.id);
    if (!referenceDurable) retryRecorded = await recordSupersedeReferenceRetry(input, doc.id);
  } catch {
    retryRecorded = await recordSupersedeReferenceRetry(input, doc.id);
  }
  if (referenceDurable) return { status: "superseded", billingDocumentId: doc.id, referenceDurable: true, retryRecorded: false };
  if (retryRecorded) return { status: "superseded_reference_retry_recorded", billingDocumentId: doc.id, referenceDurable: false, retryRecorded: true };
  return { status: "superseded_reference_not_durable", billingDocumentId: doc.id, referenceDurable: false, retryRecorded: false };
}

/** K7: record an exact PHI-free `supersede_billing_document` retry (the writer that
 *  wires this previously-dead action) targeting the exact Billing Document lineage.
 *  Returns whether the retry was DURABLY persisted — the caller must not overstate
 *  reconciliation durability when this is false. */
async function recordSupersedeReferenceRetry(input: { clinicId: number; ancillaryCaseId: number }, billingDocumentId: number): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "billing_document", sourceTable: BILLING_DOCUMENT_SOURCE_TABLE, sourceId: billingDocumentId, requestedAction: "supersede_billing_document", sourceSystem: "billing_lifecycle_orchestration", errorCode: "billing_reference_supersession_deferred" });
    return true;
  } catch { return false; }
}

/** K8/K12 exact-source post-condition: reference supersession is DURABLE for the EXACT
 *  named document only when the COMPLETE bounded set of its current (non-superseded)
 *  `billing_document` references is empty. Loads LIMIT+1 — a truncated set cannot be
 *  proven complete → non-durable; any current exact reference → non-durable. */
export async function billingReferenceSupersessionDurableForDocument(clinicId: number, ancillaryCaseId: number, billingDocumentId: number): Promise<boolean> {
  const SCAN = 200;
  const refs = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.sourceTable, BILLING_DOCUMENT_SOURCE_TABLE),
    eq(ancillaryDocumentReferences.sourceId, billingDocumentId),
    eq(ancillaryDocumentReferences.documentKind, "billing_document"),
    isNull(ancillaryDocumentReferences.supersededAt),
  )).limit(SCAN + 1);
  // RAW query truncation FIRST — before ANY in-memory filter. If the bounded query hit its
  // limit the exact current set cannot be proven complete → non-durable (never fail OPEN).
  if (refs.length > SCAN) return false;
  // Re-apply the exact SQL scope in memory (clinic / sourceTable / exact sourceId /
  // documentKind / current) — the exact current `billing_document` reference set for THIS
  // document, independent of ancillary case.
  const exact = refs.filter((r) => r.clinicId === clinicId && r.sourceId === billingDocumentId && r.supersededAt == null);
  // RAW truncation of the exact current set, checked BEFORE narrowing to the case — a
  // truncated set that would filter to zero rows for THIS case must never fail OPEN.
  if (exact.length > SCAN) return false;
  // Any current exact reference under a DIFFERENT ancillary case is a same-source
  // ownership/integrity conflict — never filter it away and call the set durable.
  if (exact.some((r) => (r.ancillaryCaseId ?? null) !== ancillaryCaseId)) return false;
  // Durable only when NO current exact reference remains for this exact document.
  return exact.length === 0;
}

/** K8 post-condition: reference supersession is DURABLE only when no current
 *  (non-superseded) `billing_document` reference points at a superseded/voided
 *  document for this case. Batched (one docs read via inArray) — never per-ref N+1. */
export async function billingReferenceSupersessionDurable(clinicId: number, ancillaryCaseId: number): Promise<boolean> {
  const refs = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId),
    eq(ancillaryDocumentReferences.documentKind, "billing_document"),
    isNull(ancillaryDocumentReferences.supersededAt),
  )).limit(200);
  const srcIds = [...new Set(refs.map((r) => r.sourceId).filter((x): x is number => x != null))];
  if (srcIds.length === 0) return true;
  const docs = await db.select().from(billingDocumentRequests).where(and(eq(billingDocumentRequests.clinicId, clinicId), inArray(billingDocumentRequests.id, srcIds))).limit(200);
  const docById = new Map(docs.filter((d) => d.clinicId === clinicId).map((d) => [d.id, d]));
  for (const ref of refs) {
    const doc = ref.sourceId != null ? docById.get(ref.sourceId) : undefined;
    if (doc && (doc.supersededAt != null || doc.canonicalStatus === "superseded" || doc.canonicalStatus === "voided")) return false;
  }
  return true;
}
