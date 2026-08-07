/**
 * Phase 2G — canonical Billing Document create/adopt + deterministic generator.
 *
 * The Billing Document is an OPERATIONAL BILLING PACKET — NOT a clinical note,
 * claim, invoice, remittance, payment, allocation, or proof of payer coverage.
 * Generation is DETERMINISTIC and non-AI (generatedByAi=false) and includes ONLY
 * exact known facts from the current canonical readiness snapshot + exact
 * evidence references. It NEVER invents or infers CPT/HCPCS/ICD/modifier/unit/
 * POS/NPI/payer/authorization values — missing data stays a blocker/warning.
 *
 * Case-scoped identity (clinicId + ancillaryCaseId). Concurrency-safe: claims
 * exactly one pending row (id + clinic + case + status + non-superseded) via
 * `.returning()`; a second worker never generates twice. Date of service is the
 * PERSISTED procedure completedAt — never the retry time. Runs create/adopt
 * under billingDocumentRuntimeEnabled(); the generator under
 * billingDocumentGeneratorEnabled().
 */

import { db } from "../../db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { canonicalBillingReadinessChecks as billingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests as billingDocumentRequests } from "@shared/schema/billingDocuments";
import { ancillaryDocumentReferences, BILLING_DOCUMENT_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { createReference, recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";
import { billingDocumentRuntimeEnabled, billingDocumentGeneratorEnabled } from "../../lib/featureFlags";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
const GENERATION_VERSION = "billing_packet_v1";

type ReadinessRow = typeof billingReadinessChecks.$inferSelect;
type DocRow = typeof billingDocumentRequests.$inferSelect;

export type CreateBillingDocumentResult = {
  status: "created" | "reused" | "not_ready" | "stale_readiness" | "ownership_conflict" | "missing_exact_evidence" | "skipped_flag_off" | "migration_missing" | "persistence_not_recorded";
  billingDocumentId?: number;
};

export type GenerateBillingDocumentResult = {
  status:
    | "generated" | "already_generated" | "already_claimed" | "not_ready"
    | "stale_readiness" | "ownership_conflict" | "missing_exact_evidence"
    | "generated_reference_retry_recorded" | "generated_reference_retry_not_recorded"
    | "failed_retry_recorded" | "failed_retry_not_recorded" | "migration_missing"
    | "skipped_flag_off" | "not_pending" | "failure_not_verified";
  billingDocumentId?: number;
};

type GenInput = { clinicId: number; ancillaryCaseId: number; billingDocumentId: number; source: string };

/** Load the EXACT current (non-superseded) canonical readiness row for the case. */
async function currentReadiness(clinicId: number, ancillaryCaseId: number): Promise<ReadinessRow | null> {
  const rows = await db.select().from(billingReadinessChecks).where(and(
    eq(billingReadinessChecks.clinicId, clinicId),
    eq(billingReadinessChecks.ancillaryCaseId, ancillaryCaseId),
    isNull(billingReadinessChecks.supersededAt),
  )).orderBy(desc(billingReadinessChecks.evaluatedAt)).limit(1);
  return rows[0] ?? null;
}

/** Load the EXACT current active canonical Billing Document for the case. */
async function currentBillingDocument(clinicId: number, ancillaryCaseId: number): Promise<DocRow | null> {
  const rows = await db.select().from(billingDocumentRequests).where(and(
    eq(billingDocumentRequests.clinicId, clinicId),
    eq(billingDocumentRequests.ancillaryCaseId, ancillaryCaseId),
    isNull(billingDocumentRequests.supersededAt),
  )).orderBy(desc(billingDocumentRequests.createdAt)).limit(1);
  const row = rows[0] ?? null;
  if (!row) return null;
  return ["pending", "generating", "generated", "approved"].includes(row.canonicalStatus ?? "") ? row : null;
}

/**
 * Create or adopt a PENDING canonical Billing Document for a case whose EXACT
 * current readiness is ready_to_generate. Never generates a body. One current
 * per case (the partial-unique index enforces it). Reuses an existing current
 * pending/generating/generated document (idempotent).
 */
export async function createOrAdoptCanonicalBillingDocument(input: { clinicId: number; ancillaryCaseId: number; source: string }): Promise<CreateBillingDocumentResult> {
  if (!billingDocumentRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const acase = await getAncillaryCaseById(input.ancillaryCaseId);
    if (!acase) return { status: "missing_exact_evidence" };
    if (acase.clinicId !== input.clinicId) return { status: "ownership_conflict" };
    const readiness = await currentReadiness(input.clinicId, input.ancillaryCaseId);
    if (!readiness || readiness.ancillaryCaseId !== input.ancillaryCaseId || readiness.clinicId !== input.clinicId) return { status: "not_ready" };
    if (readiness.canonicalStatus !== "ready_to_generate" && readiness.canonicalStatus !== "billing_document_pending") return { status: "not_ready" };

    const existing = await currentBillingDocument(input.clinicId, input.ancillaryCaseId);
    if (existing) {
      // Same evidence version already has a current document → reuse (idempotent).
      if (existing.evidenceFingerprint === readiness.evidenceFingerprint) return { status: "reused", billingDocumentId: existing.id };
      // Different evidence version → the caller must supersede first; do not duplicate.
      return { status: "stale_readiness", billingDocumentId: existing.id };
    }
    const [row] = await db.insert(billingDocumentRequests).values({
      clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null, patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      executionCaseId: acase.executionCaseId ?? null, patientScreeningId: acase.originatingScreeningId ?? null,
      procedureEventId: readiness.procedureEventId ?? null, billingReadinessCheckId: readiness.id, serviceType: readiness.serviceType,
      reportDocumentReferenceId: readiness.reportDocumentReferenceId ?? null, orderNoteDocumentReferenceId: readiness.orderNoteDocumentReferenceId ?? null,
      procedureNoteDocumentReferenceId: readiness.procedureNoteDocumentReferenceId ?? null,
      requestStatus: "pending", canonicalStatus: "pending", generatedByAi: false,
      evidenceFingerprint: readiness.evidenceFingerprint, generationVersion: GENERATION_VERSION,
      claimBlockers: (readiness.claimBlockers ?? []) as never, sourceSystem: input.source,
    }).returning();
    return { status: "created", billingDocumentId: row.id as number };
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return { status: "migration_missing" };
    return { status: "persistence_not_recorded" };
  }
}

/** Normal generator — claims ONLY a pending canonical Billing Document. */
export async function generateBillingDocument(input: GenInput): Promise<GenerateBillingDocumentResult> {
  if (!billingDocumentGeneratorEnabled()) return { status: "skipped_flag_off" };
  return runGeneration(input, "pending");
}

/**
 * Exact FAILED Billing Document regeneration — bound to an EXACT unresolved
 * generate_billing_document failure (matching action + source + clinic + case),
 * else failure_not_verified with no claim. Reclaims ONLY the exact failed row.
 */
export async function retryFailedBillingDocumentGeneration(input: GenInput & { failureId: number }): Promise<GenerateBillingDocumentResult> {
  if (!billingDocumentGeneratorEnabled()) return { status: "skipped_flag_off" };
  const { getUnresolvedAncillaryDocumentFailureById } = await import("../../repositories/ancillaryDocuments.repo");
  const failure = await getUnresolvedAncillaryDocumentFailureById({ id: input.failureId, clinicId: input.clinicId });
  if (
    !failure || failure.id !== input.failureId || failure.clinicId !== input.clinicId
    || failure.ancillaryCaseId !== input.ancillaryCaseId || failure.documentKind !== "billing_document"
    || failure.requestedAction !== "generate_billing_document" || failure.sourceTable !== BILLING_DOCUMENT_SOURCE_TABLE
    || failure.sourceId !== input.billingDocumentId || failure.resolvedAt != null
  ) {
    return { status: "failure_not_verified" };
  }
  return runGeneration(input, "failed");
}

async function runGeneration(input: GenInput, fromStatus: "pending" | "failed"): Promise<GenerateBillingDocumentResult> {
  try {
    const [doc] = await db.select().from(billingDocumentRequests).where(eq(billingDocumentRequests.id, input.billingDocumentId)).limit(1);
    if (!doc) return { status: "missing_exact_evidence" };
    if (doc.clinicId !== input.clinicId || doc.ancillaryCaseId !== input.ancillaryCaseId) return { status: "ownership_conflict" };
    if (doc.canonicalStatus === "generated" || doc.canonicalStatus === "approved") return { status: "already_generated", billingDocumentId: doc.id };
    if (doc.supersededAt != null || doc.canonicalStatus === "superseded" || doc.canonicalStatus === "voided") return { status: "not_pending" };
    if (doc.canonicalStatus !== fromStatus) return { status: "not_pending" };

    // The EXACT current readiness must still be ready_to_generate AND its evidence
    // version must still match this document's — else the snapshot is stale.
    const readiness = await currentReadiness(input.clinicId, input.ancillaryCaseId);
    if (!readiness || readiness.canonicalStatus !== "ready_to_generate") return { status: "not_ready" };
    if (readiness.evidenceFingerprint !== doc.evidenceFingerprint) return { status: "stale_readiness" };
    if ((readiness.billingBlockers as unknown[] | null ?? []).length > 0) return { status: "not_ready" };

    // Atomically CLAIM the exact row → generating (second worker gets 0 rows).
    const claimed = await db.update(billingDocumentRequests)
      .set({ canonicalStatus: "generating", requestStatus: "generating", updatedAt: new Date() })
      .where(and(
        eq(billingDocumentRequests.id, input.billingDocumentId), eq(billingDocumentRequests.clinicId, input.clinicId),
        eq(billingDocumentRequests.ancillaryCaseId, input.ancillaryCaseId), eq(billingDocumentRequests.canonicalStatus, fromStatus),
        isNull(billingDocumentRequests.supersededAt),
      )).returning();
    if (claimed.length !== 1) return { status: "already_claimed" };

    return await finalizeBillingDocument(input, readiness);
  } catch (e) {
    return await catchToResult(input, e);
  }
}

/** After a successful claim: build the deterministic packet from EXACT facts,
 *  commit generated, mirror the reference truthfully. */
async function finalizeBillingDocument(input: GenInput, readiness: ReadinessRow): Promise<GenerateBillingDocumentResult> {
  const snapshot = (readiness.evidenceSnapshot ?? {}) as Record<string, unknown>;
  const dos = snapshot.procedure_completed_at ?? null; // PERSISTED procedure time — never retry time.
  const claimBlockers = (readiness.claimBlockers ?? []) as unknown[];
  const warnings = (readiness.warnings ?? []) as unknown[];
  // EXACT facts only — no invented CPT/HCPCS/ICD/modifier/unit/POS/NPI/payer.
  const sourceData = {
    document_kind: "billing_packet", generation_version: GENERATION_VERSION, generated_by_ai: false,
    clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, service_type: readiness.serviceType,
    date_of_service: dos, procedure_event_id: snapshot.procedure_event_id ?? null,
    report_reference_id: snapshot.report_reference_id ?? null,
    order_note_reference_id: snapshot.order_note_reference_id ?? null, order_note_status: snapshot.order_note_status ?? null, order_note_signed_at: snapshot.order_note_signed_at ?? null,
    procedure_note_reference_id: snapshot.procedure_note_reference_id ?? null, procedure_note_status: snapshot.procedure_note_status ?? null, procedure_note_signed_at: snapshot.procedure_note_signed_at ?? null,
    billing_readiness_check_id: readiness.id, evidence_fingerprint: readiness.evidenceFingerprint,
    claim_blockers: claimBlockers, warnings, billing_blockers: [],
  };
  const body = renderPacket(sourceData);
  const [done] = await db.update(billingDocumentRequests)
    .set({
      canonicalStatus: "generated", requestStatus: "generated", generatedBody: body, sourceData: sourceData as never,
      generatedByAi: false, claimBlockers: claimBlockers as never, warnings: warnings as never, errorCode: null,
      generatedAt: new Date(), generationVersion: GENERATION_VERSION, updatedAt: new Date(),
    })
    .where(and(eq(billingDocumentRequests.id, input.billingDocumentId), eq(billingDocumentRequests.clinicId, input.clinicId), eq(billingDocumentRequests.canonicalStatus, "generating")))
    .returning();
  if (!done) { const rec = await failDoc(input, "generation_commit_conflict"); return { status: rec ? "failed_retry_recorded" : "failed_retry_not_recorded" }; }

  // Project onto ONE exact unified reference (create/reuse; body NEVER stored there).
  const created2 = await runBillingReferenceCreate(input, done as DocRow, readiness);
  if (created2 === "created" || created2 === "reused") return { status: "generated", billingDocumentId: input.billingDocumentId };
  // A missing/failed projection is recovered by link_billing_document (the CREATE path).
  const rec = await recordBillingRefRetry({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, billingDocumentId: input.billingDocumentId, source: input.source }, "link_billing_document");
  return { status: rec ? "generated_reference_retry_recorded" : "generated_reference_retry_not_recorded", billingDocumentId: input.billingDocumentId };
}

/** Core create of the ONE exact billing_document reference (documentStatus
 *  generated; effectiveClinicalDate = persisted procedure completedAt;
 *  actualCreatedAt = source createdAt). Returns the createReference category;
 *  NEVER overwrites a different active source (conflicts surfaced). */
async function runBillingReferenceCreate(input: GenInput, doc: DocRow, readiness: ReadinessRow): Promise<"created" | "reused" | "ownership_conflict" | "migration_missing" | "error"> {
  const snapshot = (readiness.evidenceSnapshot ?? {}) as Record<string, unknown>;
  const dos = snapshot.procedure_completed_at ? new Date(String(snapshot.procedure_completed_at)) : null;
  try {
    const ref = await createReference({
      clinicId: input.clinicId, globalPlexusPatientId: doc.globalPlexusPatientId ?? null, patientClinicMembershipId: doc.patientClinicMembershipId ?? null,
      patientScreeningId: doc.patientScreeningId ?? null, executionCaseId: doc.executionCaseId ?? null, ancillaryCaseId: input.ancillaryCaseId,
      documentKind: "billing_document", sourceSystem: input.source, sourceTable: BILLING_DOCUMENT_SOURCE_TABLE, sourceId: doc.id,
      serviceType: doc.serviceType, documentStatus: "generated", effectiveClinicalDate: dos, actualCreatedAt: doc.createdAt ?? null,
      metadata: { billing_readiness_check_id: readiness.id, evidence_fingerprint: doc.evidenceFingerprint ?? null },
    });
    if (ref.outcome === "created") return "created";
    if (ref.outcome === "reused_exact_source_unchanged" || ref.outcome === "reused_exact_source_updated") return "reused";
    if (ref.outcome === "active_kind_conflict" || ref.outcome === "source_clinic_conflict" || ref.outcome === "source_case_conflict") return "ownership_conflict";
    return "error";
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return "migration_missing";
    return "error";
  }
}

/**
 * §5 — EXECUTABLE exact billing_document reference projection (the
 * link_billing_document recovery path). Loads the exact generated Billing
 * Document + its exact current readiness/evidence, then CREATES the missing
 * reference via createReference. Accepts only created / reused-exact-source;
 * surfaces active-kind / source-ownership conflicts (never overwrites a different
 * active source). This is a CREATE path — distinct from the sync-only updater.
 */
export async function projectExactBillingDocumentReference(input: GenInput): Promise<"projected" | "already_projected" | "ownership_conflict" | "not_projectable" | "stale_readiness" | "source_not_found" | "migration_missing" | "retry_recorded" | "retry_not_recorded"> {
  if (!billingDocumentRuntimeEnabled()) return "not_projectable";
  try {
    const [doc] = await db.select().from(billingDocumentRequests).where(eq(billingDocumentRequests.id, input.billingDocumentId)).limit(1);
    if (!doc) return "source_not_found";
    if (doc.clinicId !== input.clinicId || doc.ancillaryCaseId !== input.ancillaryCaseId) return "ownership_conflict";
    if (doc.canonicalStatus !== "generated" && doc.canonicalStatus !== "approved") return "not_projectable";
    if (doc.supersededAt != null) return "not_projectable";
    const readiness = await currentReadiness(input.clinicId, input.ancillaryCaseId);
    if (!readiness) return "not_projectable";
    // §3 — the Billing Document MUST belong to the EXACT current readiness evidence
    // version before any reference is created/reused. A superseded/older/mismatched
    // evidence version is NEVER projected merely because the doc is still generated.
    if (readiness.clinicId !== input.clinicId || readiness.ancillaryCaseId !== input.ancillaryCaseId) return "ownership_conflict";
    if (
      readiness.canonicalStatus !== "ready_to_generate"
      || readiness.supersededAt != null
      || readiness.evidenceFingerprint == null
      || doc.evidenceFingerprint !== readiness.evidenceFingerprint
      || doc.billingReadinessCheckId !== readiness.id
      || doc.procedureEventId !== readiness.procedureEventId
      || doc.reportDocumentReferenceId !== readiness.reportDocumentReferenceId
      || doc.orderNoteDocumentReferenceId !== readiness.orderNoteDocumentReferenceId
      || doc.procedureNoteDocumentReferenceId !== readiness.procedureNoteDocumentReferenceId
      || doc.serviceType !== readiness.serviceType
    ) return "stale_readiness";
    const outcome = await runBillingReferenceCreate(input, doc as DocRow, readiness);
    if (outcome === "created") return "projected";
    if (outcome === "reused") return "already_projected";
    if (outcome === "ownership_conflict") return "ownership_conflict";
    if (outcome === "migration_missing") return "migration_missing";
    return (await recordBillingRefRetry(input, "link_billing_document")) ? "retry_recorded" : "retry_not_recorded";
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return "migration_missing";
    return (await recordBillingRefRetry(input, "link_billing_document")) ? "retry_recorded" : "retry_not_recorded";
  }
}

/** Deterministic, timeless billing packet — evidence-only, NO invented codes. */
function renderPacket(d: Record<string, unknown>): string {
  const dos = d.date_of_service ? String(d.date_of_service).slice(0, 10) : "the recorded procedure date";
  return [
    `Operational Billing Packet — ${d.service_type}.`,
    `Case ${d.ancillary_case_id} (clinic ${d.clinic_id}). Date of service: ${dos}.`,
    `Evidence: procedure event #${d.procedure_event_id ?? "-"}, report reference #${d.report_reference_id ?? "-"}, Order Note reference #${d.order_note_reference_id ?? "-"} (${d.order_note_status ?? "-"}), Procedure Note reference #${d.procedure_note_reference_id ?? "-"} (${d.procedure_note_status ?? "-"}).`,
    `This is an operational billing packet only — NOT a claim, invoice, remittance, or payment, and NOT proof of payer coverage or prior authorization. Billing codes and payer data are included ONLY when present in approved canonical data; none are invented.`,
    `Claim-submission blockers (carried to Phase 2J): ${(d.claim_blockers as unknown[]).length}.`,
  ].join("\n");
}

/** §5 — SYNC-ONLY: mirror a Billing Document status transition onto its EXACT
 *  EXISTING unified reference (exact clinic+case+source+kind, affected-row
 *  checked). This is NOT a create path: a MISSING reference records a
 *  link_billing_document retry (the create path) and returns reference_missing;
 *  an existing-but-failed status update records a sync_billing_document_reference
 *  retry. Returns synced / reference_missing / retry_recorded / retry_not_recorded. */
export async function syncBillingDocumentReference(args: { clinicId: number; ancillaryCaseId: number; billingDocumentId: number; documentStatus: string; source: string }): Promise<"synced" | "reference_missing" | "retry_recorded" | "retry_not_recorded"> {
  try {
    const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.sourceTable, BILLING_DOCUMENT_SOURCE_TABLE),
      eq(ancillaryDocumentReferences.sourceId, args.billingDocumentId),
      eq(ancillaryDocumentReferences.documentKind, "billing_document"),
    )).limit(1);
    // No existing reference → NOT this handler's job to create it. Record the
    // CREATE action (link_billing_document) and report missing (never resolves here).
    if (!ref) { await recordBillingRefRetry(args, "link_billing_document"); return "reference_missing"; }
    if (ref.clinicId !== args.clinicId || ref.ancillaryCaseId !== args.ancillaryCaseId) return (await recordBillingRefRetry(args, "sync_billing_document_reference")) ? "retry_recorded" : "retry_not_recorded";
    const rows = await db.update(ancillaryDocumentReferences)
      .set({ documentStatus: args.documentStatus, updatedAt: new Date() })
      .where(and(
        eq(ancillaryDocumentReferences.id, ref.id), eq(ancillaryDocumentReferences.clinicId, args.clinicId),
        eq(ancillaryDocumentReferences.ancillaryCaseId, args.ancillaryCaseId),
        eq(ancillaryDocumentReferences.sourceTable, BILLING_DOCUMENT_SOURCE_TABLE),
        eq(ancillaryDocumentReferences.sourceId, args.billingDocumentId), eq(ancillaryDocumentReferences.documentKind, "billing_document"),
      )).returning();
    if (rows.length !== 1) return (await recordBillingRefRetry(args, "sync_billing_document_reference")) ? "retry_recorded" : "retry_not_recorded";
    return "synced";
  } catch { return (await recordBillingRefRetry(args, "sync_billing_document_reference")) ? "retry_recorded" : "retry_not_recorded"; }
}

/**
 * §2 — EXACT reference-durability check for a generated/approved Billing
 * Document. A generation failure may resolve ONLY when at least one durable
 * recovery guarantee exists: the exact billing_document reference is PRESENT
 * (correct ownership), OR a distinct exact link_billing_document recovery failure
 * is durably recorded. A missing reference whose link retry cannot be persisted
 * keeps the generation failure OPEN (never erases the only recovery path).
 */
export async function ensureBillingReferenceDurability(args: { clinicId: number; ancillaryCaseId: number; billingDocumentId: number; source: string }): Promise<"reference_present" | "link_retry_recorded" | "link_retry_not_recorded" | "ownership_conflict" | "duplicate_current_reference" | "migration_missing"> {
  try {
    // K10: current-reference durability requires exactly ONE non-superseded owned row.
    // A superseded reference NEVER satisfies durability; a mismatched owner or a duplicate
    // current row is a fail-closed integrity conflict (never resolves the generate failure).
    const refs = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.sourceTable, BILLING_DOCUMENT_SOURCE_TABLE),
      eq(ancillaryDocumentReferences.sourceId, args.billingDocumentId),
      eq(ancillaryDocumentReferences.documentKind, "billing_document"),
    )).limit(50);
    if (refs.some((r) => r.clinicId !== args.clinicId || r.ancillaryCaseId !== args.ancillaryCaseId)) return "ownership_conflict";
    const current = refs.filter((r) => r.supersededAt == null);
    if (current.length > 1) return "duplicate_current_reference";
    if (current.length === 1) return "reference_present";
    // 0 current (none, or ONLY superseded) → the exact recovery is a link_billing_document
    // failure that (re)creates the current reference. A superseded-only ref is NOT durable.
    return (await recordBillingRefRetry(args, "link_billing_document")) ? "link_retry_recorded" : "link_retry_not_recorded";
  } catch (e) {
    if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) return "migration_missing";
    return (await recordBillingRefRetry(args, "link_billing_document")) ? "link_retry_recorded" : "link_retry_not_recorded";
  }
}

/** Record an exact PHI-free billing reference retry under the CORRECT action:
 *  link_billing_document for a missing reference (create path);
 *  sync_billing_document_reference for a status-sync failure on an existing one. */
async function recordBillingRefRetry(args: { clinicId: number; ancillaryCaseId: number; billingDocumentId: number; source: string }, action: "link_billing_document" | "sync_billing_document_reference"): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({ clinicId: args.clinicId, ancillaryCaseId: args.ancillaryCaseId, documentKind: "billing_document", sourceTable: BILLING_DOCUMENT_SOURCE_TABLE, sourceId: args.billingDocumentId, requestedAction: action, sourceSystem: "billing_document_generator", errorCode: action === "link_billing_document" ? "billing_reference_missing" : "billing_reference_sync_failed" });
    return true;
  } catch { return false; }
}

async function failDoc(input: GenInput, code: string): Promise<boolean> {
  await db.update(billingDocumentRequests)
    .set({ canonicalStatus: "failed", requestStatus: "failed", errorCode: code, updatedAt: new Date() })
    .where(and(eq(billingDocumentRequests.id, input.billingDocumentId), eq(billingDocumentRequests.clinicId, input.clinicId), eq(billingDocumentRequests.canonicalStatus, "generating")));
  try {
    await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "billing_document", sourceTable: BILLING_DOCUMENT_SOURCE_TABLE, sourceId: input.billingDocumentId, requestedAction: "generate_billing_document", sourceSystem: "billing_document_generator", errorCode: code });
    return true;
  } catch { return false; }
}

async function catchToResult(input: GenInput, e: unknown): Promise<GenerateBillingDocumentResult> {
  if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) {
    try { await db.update(billingDocumentRequests).set({ canonicalStatus: "failed", requestStatus: "failed", updatedAt: new Date() }).where(and(eq(billingDocumentRequests.id, input.billingDocumentId), eq(billingDocumentRequests.clinicId, input.clinicId), eq(billingDocumentRequests.canonicalStatus, "generating"))); } catch { /* table missing */ }
    return { status: "migration_missing" };
  }
  let recorded = false;
  try { recorded = await failDoc(input, (e as { code?: string })?.code ?? "generation_failed"); } catch { recorded = false; }
  return { status: recorded ? "failed_retry_recorded" : "failed_retry_not_recorded" };
}

export { currentReadiness, currentBillingDocument };
