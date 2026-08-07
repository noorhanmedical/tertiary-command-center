// Phase 2J — canonical CLAIM command service (transactional, idempotent).
//
// Real write lifecycle: create-or-reuse one active draft per exact evidence version,
// transition along the explicit state machine, and create correction attempts with
// exact parent lineage. Every command re-evaluates EXACT claim readiness inside its
// boundary, writes one audit/transition row in the same transaction, and uses
// affected-row checks + unique-violation convergence for concurrency. Submitted (and
// later) history is NEVER overwritten. A `submitted` status is persisted only from an
// exact authorized source (clearinghouse ack requires the transmission adapter). No
// external claim is ever transmitted here.

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import type { CanonicalClaimStatus } from "@shared/schema/canonicalClaims";
import { canonicalBillingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests } from "@shared/schema/billingDocuments";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { canonicalClaimsRuntimeEnabled, featureFlags } from "../../lib/featureFlags";
import { evaluateClaimReadiness, type CaseRef } from "./claimReadiness";
import { canTransitionClaim, claimSubmissionSourceValid } from "./stateMachines";
import { isFinancialMigration, writeTransition, resolveFinancialCommandRace, commandFingerprint, verifyCanonicalIdentity, nonEmpty, type DbLike } from "./commandSupport";

const WORKING_STATUSES = new Set<CanonicalClaimStatus>(["not_ready", "ready", "draft", "queued"]);
const UNIQUE_VIOLATION = "23505";
function isUnique(e: unknown): boolean { return (e as { code?: string })?.code === UNIQUE_VIOLATION; }

export type ClaimCommandResult =
  | { status: "skipped_flag_off" }
  | { status: "created"; claimId: number; claimReady: boolean; blockers: { code: string }[] }
  | { status: "reused"; claimId: number }
  | { status: "not_found" }
  | { status: "identity_incomplete"; identityFailure?: string }
  | { status: "evidence_conflict"; blockers: { code: string }[] }
  | { status: "invalid_transition"; from: string; to: string }
  | { status: "submission_source_required" }
  | { status: "submission_provenance_required" }
  | { status: "transmission_unavailable" }
  | { status: "transitioned"; claimId: number; from: string; to: string }
  | { status: "conflict" }
  | { status: "idempotency_conflict" }
  | { status: "idempotency_required" }
  | { status: "migration_missing" }
  | { status: "persistence_failed" };

async function loadCase(clinicId: number, ancillaryCaseId: number) {
  const rows = await db.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, clinicId), eq(patientAncillaryCases.id, ancillaryCaseId))).limit(2);
  return rows.find((r) => r.id === ancillaryCaseId && r.clinicId === clinicId) ?? null;
}
/** EXACT case-scoped current evidence (never a clinic-wide scan). */
async function loadCaseEvidence(clinicId: number, ancillaryCaseId: number) {
  const readiness = (await db.select().from(canonicalBillingReadinessChecks).where(and(
    eq(canonicalBillingReadinessChecks.clinicId, clinicId), eq(canonicalBillingReadinessChecks.ancillaryCaseId, ancillaryCaseId), isNull(canonicalBillingReadinessChecks.supersededAt),
  )).limit(200)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId && r.supersededAt == null);
  const docs = (await db.select().from(canonicalBillingDocumentRequests).where(and(
    eq(canonicalBillingDocumentRequests.clinicId, clinicId), eq(canonicalBillingDocumentRequests.ancillaryCaseId, ancillaryCaseId), isNull(canonicalBillingDocumentRequests.supersededAt),
  )).limit(200)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId && r.supersededAt == null);
  return { readiness, docs };
}
type ClaimRow = typeof canonicalClaims.$inferSelect;
type Pick<R> = { kind: "missing" } | { kind: "one"; row: R } | { kind: "conflict" };
/** The ONE active working draft — never rows[0]. 0 → missing, 1 → one, >1 → conflict. */
async function currentActiveDraft(clinicId: number, ancillaryCaseId: number): Promise<Pick<ClaimRow>> {
  const rows = (await db.select().from(canonicalClaims).where(and(
    eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.ancillaryCaseId, ancillaryCaseId), isNull(canonicalClaims.supersededAt),
  )).limit(50)).filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId && r.supersededAt == null && WORKING_STATUSES.has(r.canonicalStatus as CanonicalClaimStatus));
  if (rows.length === 0) return { kind: "missing" };
  if (rows.length > 1) return { kind: "conflict" };
  return { kind: "one", row: rows[0] };
}
/** Exact-equality reuse: a draft is reused ONLY when EVERY evidence facet matches
 *  the freshly-evaluated version — otherwise it is stale and must NOT be reused. */
function claimReuseMatches(row: ClaimRow, ev: NonNullable<ReturnType<typeof evaluateClaimReadiness>["evidence"]>, c: CaseRef): boolean {
  return row.evidenceFingerprint === ev.evidenceFingerprint
    && (row.billingDocumentId ?? null) === ev.billingDocumentId
    && (row.billingReadinessCheckId ?? null) === ev.billingReadinessCheckId
    && (row.procedureEventId ?? null) === ev.procedureEventId
    && (row.orderNoteDocumentReferenceId ?? null) === ev.orderNoteDocumentReferenceId
    && (row.reportDocumentReferenceId ?? null) === ev.reportDocumentReferenceId
    && (row.procedureNoteDocumentReferenceId ?? null) === ev.procedureNoteDocumentReferenceId
    && (row.ancillaryCaseId ?? null) === c.ancillaryCaseId && row.serviceType === c.serviceType && row.clinicId === c.clinicId;
}
function evidenceValues(ev: NonNullable<ReturnType<typeof evaluateClaimReadiness>["evidence"]>, acase: { globalPlexusPatientId: number | null; patientClinicMembershipId: number | null }) {
  return {
    billingDocumentId: ev.billingDocumentId, billingReadinessCheckId: ev.billingReadinessCheckId, evidenceFingerprint: ev.evidenceFingerprint,
    orderNoteDocumentReferenceId: ev.orderNoteDocumentReferenceId, reportDocumentReferenceId: ev.reportDocumentReferenceId,
    procedureNoteDocumentReferenceId: ev.procedureNoteDocumentReferenceId, procedureEventId: ev.procedureEventId,
    globalPlexusPatientId: acase.globalPlexusPatientId, patientClinicMembershipId: acase.patientClinicMembershipId,
    // Persist the EXACT validated payload verbatim (never re-read sourceData later).
    currency: ev.currency ?? "USD", chargeAmount: ev.chargeAmount, amountSource: ev.amountSource,
    lineItems: (ev.lineItems ?? []) as never, claimFields: (ev.fields ?? {}) as never, fieldProvenance: (ev.fieldProvenance ?? {}) as never,
  };
}

export type CreateDraftInput = { clinicId: number; ancillaryCaseId: number; actorUserId: string; actorRole: string; idempotencyKey: string };

export async function createOrReuseCanonicalClaimDraft(input: CreateDraftInput): Promise<ClaimCommandResult> {
  if (!canonicalClaimsRuntimeEnabled()) return { status: "skipped_flag_off" };
  if (!nonEmpty(input.idempotencyKey)) return { status: "idempotency_required" };
  try {
    const fp = commandFingerprint({ action: "create_claim_draft", clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
    const replay = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", claimId: replay.entityId };
    const acase = await loadCase(input.clinicId, input.ancillaryCaseId);
    if (!acase) return { status: "not_found" };
    // Exact canonical patient identity (never name/DOB/MRN; a non-null id pair alone
    // is insufficient) — failure creates no claim and no transition.
    const idFail = await verifyCanonicalIdentity(input.clinicId, acase.globalPlexusPatientId, acase.patientClinicMembershipId);
    if (idFail) return { status: "identity_incomplete", identityFailure: idFail };
    const ref: CaseRef = { clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, verifiedGlobalPlexusPatientId: acase.globalPlexusPatientId, verifiedPatientClinicMembershipId: acase.patientClinicMembershipId };
    const { readiness, docs } = await loadCaseEvidence(input.clinicId, input.ancillaryCaseId);
    const result = evaluateClaimReadiness(ref, readiness, docs);
    if (result.integrity === "conflicting") return { status: "evidence_conflict", blockers: result.blockers };
    if (!result.evidence) return { status: "evidence_conflict", blockers: result.blockers };

    // The ONE active working draft (never rows[0]). A stale draft (any evidence facet
    // differs) is a conflict — never silently reused.
    const existing = await currentActiveDraft(input.clinicId, input.ancillaryCaseId);
    if (existing.kind === "conflict") return { status: "conflict" };
    if (existing.kind === "one") return claimReuseMatches(existing.row, result.evidence, ref) ? { status: "reused", claimId: existing.row.id } : { status: "conflict" };

    const status: CanonicalClaimStatus = result.claimReady ? "ready" : "not_ready";
    try {
      const created = await (db as unknown as DbLike).transaction(async (tx) => {
        const [row] = await tx.insert(canonicalClaims).values({
          clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType,
          canonicalStatus: status, attemptNumber: 1,
          claimSubmissionBlockers: result.blockers as never, warnings: result.warnings as never,
          idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: "claim_command",
          ...evidenceValues(result.evidence!, acase),
        }).returning();
        await writeTransition(tx, { entityType: "claim", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, serviceType: acase.serviceType, fromStatus: null, toStatus: status, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: "draft_created", sourceType: "claim_command", idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return row;
      });
      return { status: "created", claimId: created.id as number, claimReady: result.claimReady, blockers: result.blockers };
    } catch (e) {
      if (isUnique(e)) {
        // Concurrent create or idempotency race → converge on the one existing row,
        // but REPEAT every equality check — a stale winner is a conflict, not reuse.
        const again = await currentActiveDraft(input.clinicId, input.ancillaryCaseId);
        if (again.kind === "one") return claimReuseMatches(again.row, result.evidence, ref) ? { status: "reused", claimId: again.row.id } : { status: "conflict" };
        if (again.kind === "conflict") return { status: "conflict" };
        // A racing command may have won on our idempotency key — reload the audit row
        // and compare the fingerprint (never assume the entry gate was sufficient).
        const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
        if (post.kind === "replay") return { status: "reused", claimId: post.entityId };
        if (post.kind === "conflict") return { status: "idempotency_conflict" };
      }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

export type TransitionInput2 = { clinicId: number; claimId: number; actorUserId: string; actorRole: string; transition: CanonicalClaimStatus; reason?: string | null; sourceType?: string | null; sourceReference?: string | null; idempotencyKey?: string | null };

export async function transitionCanonicalClaim(input: TransitionInput2): Promise<ClaimCommandResult> {
  if (!canonicalClaimsRuntimeEnabled()) return { status: "skipped_flag_off" };
  if (!nonEmpty(input.idempotencyKey)) return { status: "idempotency_required" };
  const fp = commandFingerprint({ action: "transition_claim", clinicId: input.clinicId, claimId: input.claimId, transition: input.transition, sourceType: input.sourceType, sourceReference: input.sourceReference, reason: input.reason });
  try {
    const replay = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "transitioned", claimId: input.claimId, from: replay.fromStatus ?? "", to: replay.toStatus ?? input.transition };
    const rows = await db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, input.clinicId), eq(canonicalClaims.id, input.claimId))).limit(2);
    const claim = rows.find((r) => r.id === input.claimId && r.clinicId === input.clinicId);
    if (!claim) return { status: "not_found" };
    const from = claim.canonicalStatus as CanonicalClaimStatus, to = input.transition;
    if (!canTransitionClaim(from, to)) return { status: "invalid_transition", from, to };

    let submission: Record<string, unknown> = {};
    if (to === "submitted") {
      if (!claimSubmissionSourceValid(input.sourceType)) return { status: "submission_source_required" };
      if (!nonEmpty(input.sourceReference) || !nonEmpty(input.reason)) return { status: "submission_provenance_required" };
      // Clearinghouse acknowledgment requires a REAL approved transmission adapter.
      if (input.sourceType === "clearinghouse_response" && !featureFlags.canonicalClaimTransmission) return { status: "transmission_unavailable" };
      submission = { submittedAt: new Date(), submissionSource: input.sourceType, submissionReference: input.sourceReference, submissionActorUserId: input.actorUserId, submissionReason: input.reason };
    }
    const done = await (db as unknown as DbLike).transaction(async (tx) => {
      const claimed = await tx.update(canonicalClaims).set({ canonicalStatus: to, updatedAt: new Date(), ...submission })
        .where(and(eq(canonicalClaims.id, input.claimId), eq(canonicalClaims.clinicId, input.clinicId), eq(canonicalClaims.canonicalStatus, from), isNull(canonicalClaims.supersededAt))).returning();
      if ((claimed as unknown[]).length !== 1) return null;
      await writeTransition(tx, { entityType: "claim", entityId: input.claimId, clinicId: input.clinicId, ancillaryCaseId: claim.ancillaryCaseId, serviceType: claim.serviceType, fromStatus: from, toStatus: to, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? null, sourceType: input.sourceType ?? "claim_command", sourceReference: input.sourceReference ?? null, idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
      return true;
    });
    if (!done) {
      // §7 zero-row update: an identical racing command may have already applied it.
      const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
      if (post.kind === "replay") return { status: "transitioned", claimId: input.claimId, from: post.fromStatus ?? from, to: post.toStatus ?? to };
      if (post.kind === "conflict") return { status: "idempotency_conflict" };
      return { status: "conflict" };
    }
    return { status: "transitioned", claimId: input.claimId, from, to };
  } catch (e) {
    // §7 unique violation: a racing identical command won — resolve by fingerprint
    // (replay the exact prior success; different intent → idempotency_conflict).
    if (isUnique(e)) {
      const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
      if (post.kind === "replay") return { status: "transitioned", claimId: input.claimId, from: post.fromStatus ?? "", to: post.toStatus ?? input.transition };
      if (post.kind === "conflict") return { status: "idempotency_conflict" };
      return { status: "conflict" };
    }
    if (isFinancialMigration(e)) return { status: "migration_missing" };
    return { status: "persistence_failed" };
  }
}

export type CorrectionInput = { clinicId: number; priorClaimId: number; actorUserId: string; actorRole: string; reason?: string | null; idempotencyKey: string };

export async function createCanonicalClaimCorrection(input: CorrectionInput): Promise<ClaimCommandResult> {
  if (!canonicalClaimsRuntimeEnabled()) return { status: "skipped_flag_off" };
  if (!nonEmpty(input.idempotencyKey)) return { status: "idempotency_required" };
  try {
    const fp = commandFingerprint({ action: "correct_claim", clinicId: input.clinicId, priorClaimId: input.priorClaimId, reason: input.reason });
    const replay = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", claimId: replay.entityId };
    const rows = await db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, input.clinicId), eq(canonicalClaims.id, input.priorClaimId))).limit(2);
    const prior = rows.find((r) => r.id === input.priorClaimId && r.clinicId === input.clinicId);
    if (!prior) return { status: "not_found" };
    const acase = await loadCase(input.clinicId, prior.ancillaryCaseId as number);
    if (!acase) return { status: "not_found" };
    const idFail = await verifyCanonicalIdentity(input.clinicId, acase.globalPlexusPatientId, acase.patientClinicMembershipId);
    if (idFail) return { status: "identity_incomplete", identityFailure: idFail };
    const { readiness, docs } = await loadCaseEvidence(input.clinicId, prior.ancillaryCaseId as number);
    const result = evaluateClaimReadiness({ clinicId: input.clinicId, ancillaryCaseId: prior.ancillaryCaseId as number, serviceType: prior.serviceType, verifiedGlobalPlexusPatientId: acase.globalPlexusPatientId, verifiedPatientClinicMembershipId: acase.patientClinicMembershipId }, readiness, docs);
    if (result.integrity === "conflicting" || !result.evidence) return { status: "evidence_conflict", blockers: result.blockers };
    const priorWorking = WORKING_STATUSES.has(prior.canonicalStatus as CanonicalClaimStatus);
    const status: CanonicalClaimStatus = result.claimReady ? "ready" : "not_ready";
    try {
      const created = await (db as unknown as DbLike).transaction(async (tx) => {
        if (priorWorking) {
          // Supersede the unsubmitted working draft (submitted history is untouched).
          const sup = await tx.update(canonicalClaims).set({ canonicalStatus: "superseded", supersededAt: new Date(), updatedAt: new Date() })
            .where(and(eq(canonicalClaims.id, prior.id), eq(canonicalClaims.clinicId, input.clinicId), eq(canonicalClaims.canonicalStatus, prior.canonicalStatus), isNull(canonicalClaims.supersededAt))).returning();
          if ((sup as unknown[]).length !== 1) return null;
        }
        const [row] = await tx.insert(canonicalClaims).values({
          clinicId: input.clinicId, ancillaryCaseId: prior.ancillaryCaseId, serviceType: prior.serviceType,
          canonicalStatus: status, attemptNumber: (prior.attemptNumber ?? 1) + 1, supersedesClaimId: prior.id,
          claimSubmissionBlockers: result.blockers as never, warnings: result.warnings as never,
          idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: "claim_correction",
          ...evidenceValues(result.evidence!, acase),
        }).returning();
        await writeTransition(tx, { entityType: "claim", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: prior.ancillaryCaseId, serviceType: prior.serviceType, fromStatus: null, toStatus: status, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? "correction_created", sourceType: "claim_correction", sourceReference: String(prior.id), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return row;
      });
      if (!created) return { status: "conflict" };
      return { status: "created", claimId: created.id as number, claimReady: result.claimReady, blockers: result.blockers };
    } catch (e) {
      // §7 racing identical correction won → replay its exact prior success.
      if (isUnique(e)) {
        const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "claim", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
        if (post.kind === "replay") return { status: "reused", claimId: post.entityId };
        if (post.kind === "conflict") return { status: "idempotency_conflict" };
        return { status: "conflict" };
      }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}
