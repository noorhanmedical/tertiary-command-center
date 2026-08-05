// Phase 2J — canonical PAYMENT command service (append-only, transactional).
//
// Receipt identity is SEPARATE from allocations. `recordCanonicalPayment` appends a
// receipt (never defaulting an unverified insert to posted; case/service/identity
// only from loaded canonical records). `allocateCanonicalPayment` appends one APPLY
// allocation under an advisory lock, re-validates bounds, and FAILS CLOSED on the
// target status update (exactly one affected row else the whole transaction rolls
// back → conflict). Refunds/reversals are allocation-specific: a NEW append-only
// allocation row that names an EXACT parent apply-allocation, bounded by that
// parent's remaining applied amount (refunding invoice A never touches invoice B).
// Effective balances derive from apply minus allocation-specific negations. Every
// command is idempotent by INTENT fingerprint. No real card/ACH/bank/processor op.

import { db } from "../../db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { canonicalPayments, CANONICAL_PAYMENT_TYPES } from "@shared/schema/canonicalPayments";
import { canonicalPaymentAllocations } from "@shared/schema/canonicalPaymentAllocations";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import { canonicalInvoices } from "@shared/schema/canonicalInvoices";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { patientClinicMemberships, globalPlexusPatients } from "@shared/schema/plexusIdentity";
import { canonicalPaymentsRuntimeEnabled } from "../../lib/featureFlags";
import { toCents, sumCents } from "@shared/money";
import { validateAllocation, netAppliedCents } from "./balance";
import { validateNegationLineage, sumNegationsForParent } from "./allocationLineage";
import { validateClaimLineage, validateInvoiceLineage, type LineageVerdict } from "./lineageValidators";
import { isFinancialMigration, writeTransition, resolveFinancialCommandRace, commandFingerprint, verifyCanonicalIdentity, SUPPORTED_CURRENCIES, nonEmpty, type DbLike } from "./commandSupport";

const PAYMENT_TYPES = new Set<string>(CANONICAL_PAYMENT_TYPES);
const IMPORT_TYPES = new Set(["processor_import", "remittance_import"]);
// Sources that may carry clinic-level (case-less) unapplied money.
const CLINIC_LEVEL_SOURCES = new Set(["remittance_import", "processor_import"]);
const INVOICE_PAYABLE = new Set(["issued", "delivered", "partially_paid"]);
const CLAIM_PAYABLE = new Set(["submitted", "accepted", "partially_paid"]);
const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === "23505";
const centsOf = (v: unknown): number | null => { try { return toCents(v as string); } catch { return null; } };

export type PaymentCommandResult =
  | { status: "skipped_flag_off" }
  | { status: "recorded"; paymentId: number }
  | { status: "reused"; paymentId?: number; allocationId?: number }
  | { status: "allocated"; allocationId: number; targetStatus?: string }
  | { status: "refunded"; allocationId?: number; paymentId?: number }
  | { status: "reversed"; allocationId?: number; paymentId?: number }
  | { status: "not_found" }
  | { status: "invalid_amount" }
  | { status: "invalid_source" }
  | { status: "unsupported_currency" }
  | { status: "identity_invalid"; identityFailure?: string }
  | { status: "case_service_mismatch" }
  | { status: "target_not_found" }
  | { status: "target_not_payable" }
  | { status: "allocation_rejected"; code: string }
  | { status: "allocation_integrity_unavailable" }
  | { status: "parent_allocation_invalid" }
  | { status: "external_transaction_conflict" }
  | { status: "exceeds_original" }
  | { status: "already_reversed" }
  | { status: "conflict" }
  | { status: "idempotency_conflict" }
  | { status: "idempotency_required" }
  | { status: "migration_missing" }
  | { status: "persistence_failed" };

const ALLOC_SCAN = 2000;
type Alloc = typeof canonicalPaymentAllocations.$inferSelect;
async function loadPayment(h: DbLike, clinicId: number, paymentId: number) {
  const rows = await h.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, clinicId), eq(canonicalPayments.id, paymentId))).limit(2);
  return (rows as (typeof canonicalPayments.$inferSelect)[]).find((r) => r.id === paymentId && r.clinicId === clinicId) ?? null;
}
// §9 completeness: load SCAN+1; if row 2001 exists the set is TRUNCATED and no
// financial bound may be computed from it (caller returns integrity-unavailable).
async function allocationsForPayment(h: DbLike, clinicId: number, paymentId: number): Promise<{ rows: Alloc[]; truncated: boolean }> {
  const raw = ((await h.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), eq(canonicalPaymentAllocations.paymentId, paymentId))).limit(ALLOC_SCAN + 1)) as Alloc[]).filter((r) => r.clinicId === clinicId && r.paymentId === paymentId);
  return { rows: raw.slice(0, ALLOC_SCAN), truncated: raw.length > ALLOC_SCAN };
}
async function allocationsForTarget(h: DbLike, clinicId: number, targetType: string, targetId: number): Promise<{ rows: Alloc[]; truncated: boolean }> {
  const raw = ((await h.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), eq(canonicalPaymentAllocations.targetType, targetType), eq(canonicalPaymentAllocations.targetId, targetId))).limit(ALLOC_SCAN + 1)) as Alloc[]).filter((r) => r.clinicId === clinicId && r.targetType === targetType && r.targetId === targetId);
  return { rows: raw.slice(0, ALLOC_SCAN), truncated: raw.length > ALLOC_SCAN };
}
async function advisoryLock(tx: DbLike, k1: number, k2: number) { await tx.execute(sql`SELECT pg_advisory_xact_lock(${k1}, ${k2})`); }
/** Receipt available (unapplied) balance = amount − Σ apply allocations. */
function receiptApplied(allocs: (typeof canonicalPaymentAllocations.$inferSelect)[]): number { return sumCents(allocs.filter((a) => a.eventType === "apply").map((a) => centsOf(a.amount) ?? 0)); }
/** An existing external-transaction row represents the SAME intent only when EVERY
 *  material field matches (clinic/type/amount/currency/case/service/source). Any
 *  material mismatch is a conflict — never return a different intent as `reused`. */
function externalTxnSameIntent(dup: typeof canonicalPayments.$inferSelect, input: RecordPaymentInput, caseId: number | null, serviceType: string | null): boolean {
  return dup.clinicId === input.clinicId
    && dup.paymentType === input.paymentType
    && (centsOf(dup.amount) ?? NaN) === (centsOf(input.amount) ?? NaN)
    && dup.currency === input.currency
    && (dup.ancillaryCaseId ?? null) === (caseId ?? null)
    && (dup.serviceType ?? null) === (serviceType ?? null)
    && (dup.sourceSystem ?? null) === input.sourceSystem;
}
async function findExternalTxn(clinicId: number, externalTransactionId: string) {
  return (await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, clinicId), eq(canonicalPayments.externalTransactionId, externalTransactionId))).limit(2)).find((r) => r.clinicId === clinicId && r.externalTransactionId === externalTransactionId) ?? null;
}

export type RecordPaymentInput = {
  clinicId: number; ancillaryCaseId?: number | null; serviceType?: string | null;
  paymentType: string; currency: string; amount: string; externalTransactionId?: string | null;
  receivedAt?: Date | null; actorUserId: string; actorRole: string; sourceSystem: string; idempotencyKey: string;
};

export async function recordCanonicalPayment(input: RecordPaymentInput): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  if (!nonEmpty(input.idempotencyKey)) return { status: "idempotency_required" };
  try {
    const fp = commandFingerprint({ action: "record_payment", clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, paymentType: input.paymentType, currency: input.currency, amount: input.amount, externalTransactionId: input.externalTransactionId });
    const replay = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "payment", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", paymentId: replay.entityId };
    const cents = centsOf(input.amount);
    if (cents == null || cents <= 0) return { status: "invalid_amount" };
    if (!SUPPORTED_CURRENCIES.has(input.currency)) return { status: "unsupported_currency" };
    if (!PAYMENT_TYPES.has(input.paymentType) || !nonEmpty(input.actorUserId)) return { status: "invalid_source" };
    if (IMPORT_TYPES.has(input.paymentType) && !nonEmpty(input.externalTransactionId)) return { status: "invalid_source" };

    // §6 ownership: case/service/identity persisted ONLY from the loaded canonical
    // case; clinic-level (case-less) money is explicitly unapplied and requires an
    // approved clinic-level source.
    let caseId: number | null = null, serviceType: string | null = null;
    if (input.ancillaryCaseId != null) {
      const cases = await db.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, input.clinicId), eq(patientAncillaryCases.id, input.ancillaryCaseId))).limit(2);
      const c = cases.find((x) => x.id === input.ancillaryCaseId && x.clinicId === input.clinicId);
      if (!c) return { status: "not_found" };
      if (nonEmpty(input.serviceType) && input.serviceType !== c.serviceType) return { status: "case_service_mismatch" };
      const idFail = await verifyCanonicalIdentity(input.clinicId, c.globalPlexusPatientId, c.patientClinicMembershipId);
      if (idFail) return { status: "identity_invalid", identityFailure: idFail };
      caseId = c.id; serviceType = c.serviceType;
    } else if (!CLINIC_LEVEL_SOURCES.has(input.paymentType)) {
      return { status: "invalid_source" }; // case-less money requires an approved clinic-level source
    }
    // §8 external-transaction dedup — EXACT intent equality → reused; any material
    // mismatch → conflict (never return a different intent as reused).
    if (nonEmpty(input.externalTransactionId)) {
      const dup = await findExternalTxn(input.clinicId, input.externalTransactionId as string);
      if (dup) return externalTxnSameIntent(dup, input, caseId, serviceType) ? { status: "reused", paymentId: dup.id } : { status: "external_transaction_conflict" };
    }
    try {
      const created = await (db as unknown as DbLike).transaction(async (tx) => {
        const [row] = await tx.insert(canonicalPayments).values({
          clinicId: input.clinicId, ancillaryCaseId: caseId, serviceType,
          eventType: "payment", paymentType: input.paymentType, status: "posted", currency: input.currency, amount: input.amount,
          externalTransactionId: input.externalTransactionId ?? null, receivedAt: input.receivedAt ?? null,
          idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp, actorUserId: input.actorUserId, sourceSystem: input.sourceSystem,
        }).returning();
        await writeTransition(tx, { entityType: "payment", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: caseId, serviceType, fromStatus: null, toStatus: "posted", actorUserId: input.actorUserId, actorRole: input.actorRole, reason: "payment_recorded", sourceType: input.paymentType, sourceReference: input.externalTransactionId ?? null, idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return row;
      });
      return { status: "recorded", paymentId: created.id as number };
    } catch (e) {
      if (isUnique(e)) {
        // Race lost after the entry gate — reload the audit row and compare fingerprint.
        const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "payment", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
        if (post.kind === "replay") return { status: "reused", paymentId: post.entityId };
        if (post.kind === "conflict") return { status: "idempotency_conflict" };
        if (nonEmpty(input.externalTransactionId)) { const dup = await findExternalTxn(input.clinicId, input.externalTransactionId as string); if (dup) return externalTxnSameIntent(dup, input, caseId, serviceType) ? { status: "reused", paymentId: dup.id } : { status: "external_transaction_conflict" }; }
      }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

type TargetSnap = { clinicId: number; ancillaryCaseId: number | null; serviceType: string; currency: string; totalCents: number; status: string; supersededAt: unknown; payable: boolean; evidenceFingerprint: string | null };
async function loadTarget(h: DbLike, targetType: string, clinicId: number, id: number): Promise<TargetSnap | null> {
  if (targetType === "claim") {
    const rows = await h.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.id, id))).limit(2);
    const c = (rows as (typeof canonicalClaims.$inferSelect)[]).find((r) => r.id === id && r.clinicId === clinicId); if (!c) return null;
    return { clinicId: c.clinicId, ancillaryCaseId: c.ancillaryCaseId ?? null, serviceType: c.serviceType, currency: c.currency, totalCents: centsOf(c.chargeAmount) ?? 0, status: c.canonicalStatus, supersededAt: c.supersededAt, payable: CLAIM_PAYABLE.has(c.canonicalStatus), evidenceFingerprint: c.evidenceFingerprint ?? null };
  }
  const rows = await h.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), eq(canonicalInvoices.id, id))).limit(2);
  const i = (rows as (typeof canonicalInvoices.$inferSelect)[]).find((r) => r.id === id && r.clinicId === clinicId); if (!i) return null;
  return { clinicId: i.clinicId, ancillaryCaseId: i.ancillaryCaseId ?? null, serviceType: i.serviceType, currency: i.currency, totalCents: centsOf(i.totalAmount) ?? 0, status: i.canonicalStatus, supersededAt: i.supersededAt, payable: INVOICE_PAYABLE.has(i.canonicalStatus), evidenceFingerprint: i.evidenceFingerprint ?? null };
}
/** True when the target snapshot materially changed between the pre-tx read and the
 *  under-lock reload (evidence version / total / currency / supersession / payability). */
function targetChanged(a: TargetSnap, b: TargetSnap): boolean {
  return a.evidenceFingerprint !== b.evidenceFingerprint || a.totalCents !== b.totalCents || a.currency !== b.currency || (a.supersededAt == null) !== (b.supersededAt == null) || a.status !== b.status;
}

/** §5 WRITE-PATH lineage gate. `loadTarget` proves only payable-status + non-
 *  supersession; it does NOT prove the target's identity/evidence lineage is still
 *  current. This reloads the EXACT target row + its current canonical context under
 *  the caller's lock and runs the SAME shared validators as the read model
 *  (`validateClaimLineage`/`validateInvoiceLineage`), so a still-payable-but-lineage-
 *  stale target (membership deactivated, global patient merged, evidence superseded,
 *  invoice↔claim drift) can never be driven to `paid` while the read model reports it
 *  `conflicting`. Batched exact-id lookups — no N+1. */
async function validateTargetLineage(h: DbLike, targetType: "claim" | "invoice", clinicId: number, targetId: number): Promise<LineageVerdict> {
  const first = <T,>(rows: unknown, pred: (r: T) => boolean): T | null => ((rows as T[]).find(pred) ?? null);
  if (targetType === "claim") {
    const claim = first<typeof canonicalClaims.$inferSelect>(await h.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.id, targetId))).limit(2), (r) => r.id === targetId && r.clinicId === clinicId);
    if (!claim) return { ok: false, code: "claim_case_not_found" };
    const kase = claim.ancillaryCaseId == null ? null : first<typeof patientAncillaryCases.$inferSelect>(await h.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, clinicId), eq(patientAncillaryCases.id, claim.ancillaryCaseId))).limit(2), (r) => r.id === claim.ancillaryCaseId && r.clinicId === clinicId);
    const mem = claim.patientClinicMembershipId == null ? null : first<typeof patientClinicMemberships.$inferSelect>(await h.select().from(patientClinicMemberships).where(and(eq(patientClinicMemberships.clinicId, clinicId), eq(patientClinicMemberships.id, claim.patientClinicMembershipId))).limit(2), (r) => r.id === claim.patientClinicMembershipId && r.clinicId === clinicId);
    const gp = claim.globalPlexusPatientId == null ? null : first<typeof globalPlexusPatients.$inferSelect>(await h.select().from(globalPlexusPatients).where(eq(globalPlexusPatients.id, claim.globalPlexusPatientId)).limit(2), (r) => r.id === claim.globalPlexusPatientId);
    return validateClaimLineage(claim as never, { case: kase as never, membership: mem as never, globalPatient: gp as never });
  }
  const inv = first<typeof canonicalInvoices.$inferSelect>(await h.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), eq(canonicalInvoices.id, targetId))).limit(2), (r) => r.id === targetId && r.clinicId === clinicId);
  if (!inv) return { ok: false, code: "invoice_claim_not_found" };
  const claim = inv.claimId == null ? null : first<typeof canonicalClaims.$inferSelect>(await h.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.id, inv.claimId))).limit(2), (r) => r.id === inv.claimId && r.clinicId === clinicId);
  return validateInvoiceLineage(inv as never, claim as never);
}

export type AllocateInput = { clinicId: number; paymentId: number; targetType: "claim" | "invoice"; targetId: number; amount: string; isOverpayment?: boolean; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey: string };

export async function allocateCanonicalPayment(input: AllocateInput): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  if (!nonEmpty(input.idempotencyKey)) return { status: "idempotency_required" };
  try {
    const fp = commandFingerprint({ action: "allocate_payment", clinicId: input.clinicId, paymentId: input.paymentId, targetType: input.targetType, targetId: input.targetId, amount: input.amount, isOverpayment: input.isOverpayment === true });
    const replay = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "allocation", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", allocationId: replay.entityId };
    const dbh = db as unknown as DbLike;
    const prePayment = await loadPayment(dbh, input.clinicId, input.paymentId);
    if (!prePayment) return { status: "not_found" };
    if (prePayment.eventType !== "payment" || prePayment.status !== "posted") return { status: "target_not_payable" };
    const amountCents = centsOf(input.amount);
    if (amountCents == null || amountCents <= 0) return { status: "invalid_amount" };
    const preTarget = await loadTarget(dbh, input.targetType, input.clinicId, input.targetId);
    if (!preTarget) return { status: "target_not_found" };
    if (!preTarget.payable || preTarget.supersededAt != null) return { status: "target_not_payable" };
    const targetCode = input.targetType === "invoice" ? 1 : 2;
    try {
      const result = await dbh.transaction(async (tx): Promise<PaymentCommandResult> => {
        await advisoryLock(tx, input.clinicId, input.paymentId);
        await advisoryLock(tx, input.targetId, targetCode);
        // §10 RELOAD receipt + target under the lock (never trust the pre-tx objects).
        const payment = await loadPayment(tx, input.clinicId, input.paymentId);
        if (!payment || payment.eventType !== "payment" || payment.status !== "posted") return { status: "conflict" };
        const target = await loadTarget(tx, input.targetType, input.clinicId, input.targetId);
        if (!target) return { status: "target_not_found" };
        if (!target.payable || target.supersededAt != null) return { status: "conflict" };
        // Evidence/total/currency/state changed since the pre-tx read → conflict.
        if (targetChanged(preTarget, target)) return { status: "conflict" };
        // §6 exact service ownership: reload the canonical case and prove the receipt,
        // target, and case all agree on service (both case-bound). Wrong service → no write.
        if (payment.serviceType != null && target.serviceType != null && payment.serviceType !== target.serviceType) return { status: "case_service_mismatch" };
        if (target.ancillaryCaseId != null) {
          const cases = await tx.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, input.clinicId), eq(patientAncillaryCases.id, target.ancillaryCaseId))).limit(2);
          const kase = (cases as (typeof patientAncillaryCases.$inferSelect)[]).find((x) => x.id === target.ancillaryCaseId && x.clinicId === input.clinicId);
          if (!kase || kase.serviceType !== target.serviceType) return { status: "case_service_mismatch" };
          if (payment.ancillaryCaseId != null && payment.ancillaryCaseId !== target.ancillaryCaseId) return { status: "allocation_rejected", code: "allocation_wrong_case" };
        }
        const paymentCents = centsOf(payment.amount) ?? 0;
        // §9 completeness: a truncated allocation set cannot yield a valid bound.
        const fromPayment = await allocationsForPayment(tx, input.clinicId, input.paymentId);
        const targetSet = await allocationsForTarget(tx, input.clinicId, input.targetType, input.targetId);
        if (fromPayment.truncated || targetSet.truncated) return { status: "allocation_integrity_unavailable" };
        const paymentRemaining = paymentCents - receiptApplied(fromPayment.rows);
        const targetOutstanding = Math.max(0, target.totalCents - netAppliedCents(targetSet.rows));
        const check = validateAllocation({
          paymentClinicId: input.clinicId, targetClinicId: target.clinicId,
          paymentAncillaryCaseId: payment.ancillaryCaseId ?? null, targetAncillaryCaseId: target.ancillaryCaseId ?? null,
          paymentCurrency: payment.currency, targetCurrency: target.currency,
          amountCents, paymentRemainingCents: paymentRemaining, targetOutstandingCents: targetOutstanding, allowOverpayment: input.isOverpayment === true,
        });
        if (!check.ok) return { status: "allocation_rejected", code: check.code };
        // §5 WRITE-PATH lineage gate — `paid`/`partially_paid` is created ONLY here, so
        // mirror the read model: a still-payable target whose identity/evidence lineage
        // is now stale (membership deactivated, global patient merged, evidence
        // superseded, invoice↔claim drift) must be REJECTED before any allocation drives
        // it to paid. Runs last (after balance/ownership) so existing rejections are
        // unchanged. Negation is deliberately NOT gated: it only unwinds and never
        // transitions a target INTO paid, and blocking it would strand money as paid on
        // a stale target.
        const lineage = await validateTargetLineage(tx, input.targetType, input.clinicId, input.targetId);
        if (!lineage.ok) return { status: "allocation_rejected", code: lineage.code };
        const derived = (netAppliedCents(targetSet.rows) + amountCents) >= target.totalCents ? "paid" : "partially_paid";
        const [row] = await tx.insert(canonicalPaymentAllocations).values({
          paymentId: input.paymentId, clinicId: input.clinicId, ancillaryCaseId: payment.ancillaryCaseId ?? target.ancillaryCaseId ?? null, serviceType: payment.serviceType ?? target.serviceType ?? null,
          eventType: "apply", targetType: input.targetType, targetId: input.targetId, currency: payment.currency, amount: input.amount, isOverpayment: input.isOverpayment ? 1 : 0,
          reason: input.reason ?? null, idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp, actorUserId: input.actorUserId, sourceSystem: "payment_command",
        }).returning();
        // §8 FAIL CLOSED: the derived target status update must affect EXACTLY ONE row
        // (still in its expected payable state, not superseded) — else roll back.
        const tbl = input.targetType === "claim" ? canonicalClaims : canonicalInvoices;
        const upd = await tx.update(tbl as never).set({ canonicalStatus: derived, updatedAt: new Date() } as never)
          .where(and(eq((tbl as typeof canonicalClaims).id, input.targetId), eq((tbl as typeof canonicalClaims).clinicId, input.clinicId), eq((tbl as typeof canonicalClaims).canonicalStatus, target.status), isNull((tbl as typeof canonicalClaims).supersededAt))).returning();
        if ((upd as unknown[]).length !== 1) throw Object.assign(new Error("target_update_conflict"), { code: "TARGET_UPDATE_CONFLICT" });
        await writeTransition(tx, { entityType: "allocation", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: payment.ancillaryCaseId ?? target.ancillaryCaseId ?? null, serviceType: payment.serviceType ?? target.serviceType ?? null, fromStatus: target.status, toStatus: derived, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? "allocation_applied", sourceType: input.targetType, sourceReference: String(input.targetId), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return { status: "allocated", allocationId: row.id as number, targetStatus: derived };
      });
      return result;
    } catch (e) {
      if ((e as { code?: string })?.code === "TARGET_UPDATE_CONFLICT") return { status: "conflict" };
      if (isUnique(e)) { const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "allocation", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp }); if (post.kind === "replay") return { status: "reused", allocationId: post.entityId }; if (post.kind === "conflict") return { status: "idempotency_conflict" }; }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

// §9 — allocation-specific negation (refund/reversal). Names an EXACT parent apply
// allocation; bounded by that parent's remaining applied amount; reopens the target.
export type NegateInput = { clinicId: number; paymentId: number; allocationId: number; amount: string; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey: string };

async function negateAllocation(input: NegateInput, eventType: "refund" | "reversal"): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  if (!nonEmpty(input.idempotencyKey)) return { status: "idempotency_required" };
  try {
    const fp = commandFingerprint({ action: `${eventType}_allocation`, clinicId: input.clinicId, paymentId: input.paymentId, allocationId: input.allocationId, amount: input.amount });
    const replay = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "allocation", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp });
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return eventType === "refund" ? { status: "refunded", allocationId: replay.entityId } : { status: "reversed", allocationId: replay.entityId };
    const amountCents = centsOf(input.amount);
    if (amountCents == null || amountCents <= 0) return { status: "invalid_amount" };
    const targetCode = 3;
    try {
      const result = await (db as unknown as DbLike).transaction(async (tx): Promise<PaymentCommandResult> => {
        // §4 ATOMIC: ALL checks BEFORE any insert. After the first insert, any failure
        // THROWS so the whole transaction rolls back (never a plain return).
        await advisoryLock(tx, input.clinicId, input.paymentId);
        const payment = await loadPayment(tx, input.clinicId, input.paymentId);
        if (!payment || payment.eventType !== "payment") return { status: "not_found" };
        // §6 receipt eligibility: only a POSTED payment can be negated — a pending or
        // failed receipt is never refundable/reversible.
        if (payment.status !== "posted") return { status: "target_not_payable" };
        const all = await allocationsForPayment(tx, input.clinicId, input.paymentId);
        if (all.truncated) return { status: "allocation_integrity_unavailable" };
        const parent = all.rows.find((a) => a.id === input.allocationId && a.eventType === "apply" && a.paymentId === input.paymentId && a.clinicId === input.clinicId);
        if (!parent) return { status: "parent_allocation_invalid" };
        await advisoryLock(tx, parent.targetId, targetCode);
        // Reload the exact target under the lock; missing/superseded → insert nothing.
        const target = await loadTarget(tx, parent.targetType as "claim" | "invoice", input.clinicId, parent.targetId);
        if (!target) return { status: "target_not_found" };
        if (target.supersededAt != null) return { status: "conflict" };
        // §6 negation target eligibility: only a target that currently HOLDS applied
        // money (partially_paid/paid) may be negated — never a draft/approved/voided/
        // rejected/denied/reopened target. Zero writes on an ineligible state.
        if (target.status !== "partially_paid" && target.status !== "paid") return { status: "target_not_payable" };
        // §6 service ownership: reload the exact case and prove receipt/target/case agree.
        if (target.ancillaryCaseId != null) {
          const cases = await tx.select().from(patientAncillaryCases).where(and(eq(patientAncillaryCases.clinicId, input.clinicId), eq(patientAncillaryCases.id, target.ancillaryCaseId))).limit(2);
          const kase = (cases as (typeof patientAncillaryCases.$inferSelect)[]).find((x) => x.id === target.ancillaryCaseId && x.clinicId === input.clinicId);
          if (!kase || kase.serviceType !== target.serviceType) return { status: "case_service_mismatch" };
        }
        const targetSet = await allocationsForTarget(tx, input.clinicId, parent.targetType, parent.targetId);
        if (targetSet.truncated) return { status: "allocation_integrity_unavailable" };
        // §5 lineage: the proposed negation must match its parent + receipt + target.
        const lineage = validateNegationLineage({
          parent, paymentId: input.paymentId, clinicId: input.clinicId, amountCents,
          payment: { clinicId: payment.clinicId, ancillaryCaseId: payment.ancillaryCaseId ?? null, serviceType: payment.serviceType ?? null, currency: payment.currency },
          target: { clinicId: target.clinicId, ancillaryCaseId: target.ancillaryCaseId, serviceType: target.serviceType, currency: target.currency },
          priorNegatedCents: sumNegationsForParent(all.rows, parent.id),
        });
        if (!lineage.ok) {
          if (lineage.code === "already_reversed") return { status: "already_reversed" };
          if (lineage.code === "exceeds_original") return { status: "exceeds_original" };
          if (lineage.code === "allocation_wrong_service") return { status: "case_service_mismatch" };
          if (lineage.code === "allocation_currency_mismatch" || lineage.code === "allocation_wrong_case") return { status: "allocation_rejected", code: lineage.code };
          return { status: "parent_allocation_invalid" };
        }
        // Determine the exact target transition from the effective net AFTER this negation.
        const netAfter = netAppliedCents(targetSet.rows) - amountCents;
        const derived = netAfter <= 0 ? (parent.targetType === "invoice" ? "issued" : "submitted") : netAfter >= target.totalCents ? "paid" : "partially_paid";

        // ── Only now WRITE. Any failure past here THROWS → rollback. ──
        const [row] = await tx.insert(canonicalPaymentAllocations).values({
          paymentId: input.paymentId, clinicId: input.clinicId, ancillaryCaseId: parent.ancillaryCaseId ?? null, serviceType: parent.serviceType ?? null,
          eventType, parentAllocationId: parent.id, targetType: parent.targetType, targetId: parent.targetId, currency: parent.currency, amount: input.amount,
          reason: input.reason ?? null, idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp, actorUserId: input.actorUserId, sourceSystem: `payment_${eventType}`,
        }).returning();
        const tbl = parent.targetType === "claim" ? canonicalClaims : canonicalInvoices;
        const upd = await tx.update(tbl as never).set({ canonicalStatus: derived, updatedAt: new Date() } as never)
          .where(and(eq((tbl as typeof canonicalClaims).id, parent.targetId), eq((tbl as typeof canonicalClaims).clinicId, input.clinicId), eq((tbl as typeof canonicalClaims).canonicalStatus, target.status), isNull((tbl as typeof canonicalClaims).supersededAt))).returning();
        if ((upd as unknown[]).length !== 1) throw Object.assign(new Error("target_update_conflict"), { code: "TARGET_UPDATE_CONFLICT" });
        await writeTransition(tx, { entityType: "allocation", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: parent.ancillaryCaseId ?? null, serviceType: parent.serviceType ?? null, fromStatus: "apply", toStatus: eventType, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? eventType, sourceType: `payment_${eventType}`, sourceReference: String(parent.id), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return (eventType === "refund" ? { status: "refunded", allocationId: row.id as number } : { status: "reversed", allocationId: row.id as number }) as PaymentCommandResult;
      });
      return result;
    } catch (e) {
      if ((e as { code?: string })?.code === "TARGET_UPDATE_CONFLICT") return { status: "conflict" };
      if (isUnique(e)) { const post = await resolveFinancialCommandRace(db as unknown as DbLike, { entityType: "allocation", clinicId: input.clinicId, idempotencyKey: input.idempotencyKey, commandFingerprint: fp }); if (post.kind === "replay") return eventType === "refund" ? { status: "refunded", allocationId: post.entityId } : { status: "reversed", allocationId: post.entityId }; if (post.kind === "conflict") return { status: "idempotency_conflict" }; return { status: "conflict" }; }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

export function refundCanonicalPayment(input: NegateInput): Promise<PaymentCommandResult> { return negateAllocation(input, "refund"); }
export function reverseCanonicalPayment(input: NegateInput): Promise<PaymentCommandResult> { return negateAllocation(input, "reversal"); }
