// Phase 2J — canonical PAYMENT command service (append-only, transactional).
//
// Receipt identity is SEPARATE from allocations. `recordCanonicalPayment` appends a
// receipt event; `allocateCanonicalPayment` appends one allocation applying part/all
// of a receipt to ONE exact target (claim|invoice) in the same clinic/case/currency
// and derives the target's paid/partially_paid status from the applied allocations.
// `refundCanonicalPayment`/`reverseCanonicalPayment` append NEW events tied to an
// exact prior posted payment, bounded by the original amount (no double refund/
// reversal). Nothing is ever mutated or deleted. No real card/ACH/bank/processor
// operation is executed — these are internal ledger records only.

import { db } from "../../db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { canonicalPayments, CANONICAL_PAYMENT_TYPES } from "@shared/schema/canonicalPayments";
import { canonicalPaymentAllocations } from "@shared/schema/canonicalPaymentAllocations";
import { canonicalClaims } from "@shared/schema/canonicalClaims";
import { canonicalInvoices } from "@shared/schema/canonicalInvoices";
import { canonicalPaymentsRuntimeEnabled } from "../../lib/featureFlags";
import { toCents, sumCents } from "@shared/money";
import { validateAllocation } from "./balance";
import { isFinancialMigration, writeTransition, priorTransitionEntityId, nonEmpty, type DbLike } from "./commandSupport";

const PAYMENT_TYPES = new Set<string>(CANONICAL_PAYMENT_TYPES);
const IMPORT_TYPES = new Set(["processor_import", "remittance_import"]);
const INVOICE_PAYABLE = new Set(["issued", "delivered", "partially_paid"]);
const CLAIM_PAYABLE = new Set(["submitted", "accepted", "partially_paid"]);
const UNIQUE_VIOLATION = "23505";
const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === UNIQUE_VIOLATION;
const centsOf = (v: unknown): number | null => { try { return toCents(v as string); } catch { return null; } };

export type PaymentCommandResult =
  | { status: "skipped_flag_off" }
  | { status: "recorded"; paymentId: number }
  | { status: "reused"; paymentId?: number; allocationId?: number }
  | { status: "allocated"; allocationId: number; targetStatus?: string }
  | { status: "refunded"; paymentId: number }
  | { status: "reversed"; paymentId: number }
  | { status: "not_found" }
  | { status: "invalid_amount" }
  | { status: "invalid_source" }
  | { status: "target_not_found" }
  | { status: "target_not_payable" }
  | { status: "allocation_rejected"; code: string }
  | { status: "exceeds_original" }
  | { status: "already_reversed" }
  | { status: "conflict" }
  | { status: "migration_missing" }
  | { status: "persistence_failed" };

export type RecordPaymentInput = {
  clinicId: number; ancillaryCaseId?: number | null; serviceType?: string | null;
  paymentType: string; currency: string; amount: string; externalTransactionId?: string | null;
  receivedAt?: Date | null; actorUserId: string; actorRole: string; sourceSystem: string; idempotencyKey?: string | null;
};

export async function recordCanonicalPayment(input: RecordPaymentInput): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const priorId = await priorTransitionEntityId(db as unknown as DbLike, "payment", input.clinicId, input.idempotencyKey);
    if (priorId != null) return { status: "reused", paymentId: priorId };
    // External-transaction dedup (idempotent import).
    if (nonEmpty(input.externalTransactionId)) {
      const dup = (await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, input.clinicId), eq(canonicalPayments.externalTransactionId, input.externalTransactionId as string))).limit(1))
        .find((r) => r.clinicId === input.clinicId && r.externalTransactionId === input.externalTransactionId);
      if (dup) return { status: "reused", paymentId: dup.id };
    }
    const cents = centsOf(input.amount);
    if (cents == null || cents <= 0) return { status: "invalid_amount" };
    if (!nonEmpty(input.currency)) return { status: "invalid_amount" };
    // Exact source + actor required — never default an unverified insert to posted.
    if (!PAYMENT_TYPES.has(input.paymentType) || !nonEmpty(input.actorUserId)) return { status: "invalid_source" };
    if (IMPORT_TYPES.has(input.paymentType) && !nonEmpty(input.externalTransactionId)) return { status: "invalid_source" };
    try {
      const created = await (db as unknown as DbLike).transaction(async (tx) => {
        const [row] = await tx.insert(canonicalPayments).values({
          clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId ?? null, serviceType: input.serviceType ?? null,
          eventType: "payment", paymentType: input.paymentType, status: "posted", currency: input.currency, amount: input.amount,
          externalTransactionId: input.externalTransactionId ?? null, receivedAt: input.receivedAt ?? null,
          idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: input.sourceSystem,
        }).returning();
        await writeTransition(tx, { entityType: "payment", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId ?? null, serviceType: input.serviceType ?? null, fromStatus: null, toStatus: "posted", actorUserId: input.actorUserId, actorRole: input.actorRole, reason: "payment_recorded", sourceType: input.paymentType, sourceReference: input.externalTransactionId ?? null, idempotencyKey: input.idempotencyKey ?? null });
        return row;
      });
      return { status: "recorded", paymentId: created.id as number };
    } catch (e) {
      if (isUnique(e)) {
        const byKey = await priorTransitionEntityId(db as unknown as DbLike, "payment", input.clinicId, input.idempotencyKey);
        if (byKey != null) return { status: "reused", paymentId: byKey };
        if (nonEmpty(input.externalTransactionId)) { const dup = (await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, input.clinicId), eq(canonicalPayments.externalTransactionId, input.externalTransactionId as string))).limit(1)).find((r) => r.externalTransactionId === input.externalTransactionId); if (dup) return { status: "reused", paymentId: dup.id }; }
      }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

async function loadPayment(clinicId: number, paymentId: number) {
  const rows = await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, clinicId), eq(canonicalPayments.id, paymentId))).limit(2);
  return rows.find((r) => r.id === paymentId && r.clinicId === clinicId) ?? null;
}
// Reads take an explicit handle so the bound checks can run INSIDE the transaction
// (under the advisory lock) using `tx`, not a separate `db` connection.
async function allocationsForPayment(h: DbLike, clinicId: number, paymentId: number) {
  return ((await h.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), eq(canonicalPaymentAllocations.paymentId, paymentId))).limit(2000)) as (typeof canonicalPaymentAllocations.$inferSelect)[]).filter((r) => r.clinicId === clinicId && r.paymentId === paymentId);
}
async function allocationsForTarget(h: DbLike, clinicId: number, targetType: string, targetId: number) {
  return ((await h.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), eq(canonicalPaymentAllocations.targetType, targetType), eq(canonicalPaymentAllocations.targetId, targetId))).limit(2000)) as (typeof canonicalPaymentAllocations.$inferSelect)[]).filter((r) => r.clinicId === clinicId && r.targetType === targetType && r.targetId === targetId);
}
// Serialize concurrent allocations/refunds on the same receipt/target WITHIN the
// transaction (transaction-scoped advisory lock) so the outstanding/remaining
// bounds are re-read and enforced under the lock and cannot be raced.
async function advisoryLock(tx: DbLike, k1: number, k2: number) { await tx.execute(sql`SELECT pg_advisory_xact_lock(${k1}, ${k2})`); }

export type AllocateInput = { clinicId: number; paymentId: number; targetType: "claim" | "invoice"; targetId: number; amount: string; isOverpayment?: boolean; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey?: string | null };

export async function allocateCanonicalPayment(input: AllocateInput): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const priorId = await priorTransitionEntityId(db as unknown as DbLike, "allocation", input.clinicId, input.idempotencyKey);
    if (priorId != null) return { status: "reused", allocationId: priorId };
    const payment = await loadPayment(input.clinicId, input.paymentId);
    if (!payment) return { status: "not_found" };
    if (payment.eventType !== "payment" || payment.status !== "posted") return { status: "target_not_payable" };
    const amountCents = centsOf(input.amount);
    if (amountCents == null || amountCents <= 0) return { status: "invalid_amount" };

    // Exact target (same clinic + case + currency; payable state).
    const target = input.targetType === "claim" ? await loadTargetClaim(input.clinicId, input.targetId) : await loadTargetInvoice(input.clinicId, input.targetId);
    if (!target) return { status: "target_not_found" };
    if (!target.payable) return { status: "target_not_payable" };
    const paymentCents = centsOf(payment.amount) ?? 0;
    const targetCode = input.targetType === "invoice" ? 1 : 2;
    try {
      const result = await (db as unknown as DbLike).transaction(async (tx): Promise<PaymentCommandResult> => {
        // Lock the receipt AND the target, then re-read the bounds UNDER the lock.
        await advisoryLock(tx, input.clinicId, input.paymentId);
        await advisoryLock(tx, input.targetId, targetCode);
        const paymentRemaining = paymentCents - sumCents((await allocationsForPayment(tx, input.clinicId, input.paymentId)).map((a) => centsOf(a.amount) ?? 0));
        const targetAllocated = sumCents((await allocationsForTarget(tx, input.clinicId, input.targetType, input.targetId)).map((a) => centsOf(a.amount) ?? 0));
        const targetOutstanding = Math.max(0, target.totalCents - targetAllocated);
        const check = validateAllocation({
          paymentClinicId: input.clinicId, targetClinicId: target.clinicId,
          paymentAncillaryCaseId: payment.ancillaryCaseId ?? null, targetAncillaryCaseId: target.ancillaryCaseId ?? null,
          paymentCurrency: payment.currency, targetCurrency: target.currency,
          amountCents, paymentRemainingCents: paymentRemaining, targetOutstandingCents: targetOutstanding,
          allowOverpayment: input.isOverpayment === true,
        });
        if (!check.ok) return { status: "allocation_rejected", code: check.code };
        const derived = (targetAllocated + amountCents) >= target.totalCents ? "paid" : "partially_paid";
        const [row] = await tx.insert(canonicalPaymentAllocations).values({
          paymentId: input.paymentId, clinicId: input.clinicId, ancillaryCaseId: payment.ancillaryCaseId ?? null, serviceType: payment.serviceType ?? null,
          targetType: input.targetType, targetId: input.targetId, currency: payment.currency, amount: input.amount, isOverpayment: input.isOverpayment ? 1 : 0,
          reason: input.reason ?? null, idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: "payment_command",
        }).returning();
        // Derive the target's paid/partially_paid status from applied allocations.
        const tbl = input.targetType === "claim" ? canonicalClaims : canonicalInvoices;
        const allowedFrom = input.targetType === "claim" ? [...CLAIM_PAYABLE] : [...INVOICE_PAYABLE];
        if (allowedFrom.includes(target.status)) {
          await tx.update(tbl as never).set({ canonicalStatus: derived, updatedAt: new Date() } as never)
            .where(and(eq((tbl as typeof canonicalClaims).id, input.targetId), eq((tbl as typeof canonicalClaims).clinicId, input.clinicId), eq((tbl as typeof canonicalClaims).canonicalStatus, target.status), isNull((tbl as typeof canonicalClaims).supersededAt))).returning();
        }
        await writeTransition(tx, { entityType: "allocation", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: payment.ancillaryCaseId ?? null, serviceType: payment.serviceType ?? null, fromStatus: target.status, toStatus: derived, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? "allocation_applied", sourceType: input.targetType, sourceReference: String(input.targetId), idempotencyKey: input.idempotencyKey ?? null });
        return { status: "allocated", allocationId: row.id as number, targetStatus: derived };
      });
      return result;
    } catch (e) { if (isUnique(e)) { const byKey = await priorTransitionEntityId(db as unknown as DbLike, "allocation", input.clinicId, input.idempotencyKey); if (byKey != null) return { status: "reused", allocationId: byKey }; } throw e; }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

async function loadTargetClaim(clinicId: number, id: number) {
  const rows = await db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.id, id))).limit(2);
  const c = rows.find((r) => r.id === id && r.clinicId === clinicId); if (!c) return null;
  const totalCents = centsOf(c.chargeAmount) ?? 0;
  return { clinicId: c.clinicId, ancillaryCaseId: c.ancillaryCaseId ?? null, currency: c.currency, totalCents, status: c.canonicalStatus, payable: CLAIM_PAYABLE.has(c.canonicalStatus) };
}
async function loadTargetInvoice(clinicId: number, id: number) {
  const rows = await db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), eq(canonicalInvoices.id, id))).limit(2);
  const i = rows.find((r) => r.id === id && r.clinicId === clinicId); if (!i) return null;
  const totalCents = centsOf(i.totalAmount) ?? 0;
  return { clinicId: i.clinicId, ancillaryCaseId: i.ancillaryCaseId ?? null, currency: i.currency, totalCents, status: i.canonicalStatus, payable: INVOICE_PAYABLE.has(i.canonicalStatus) };
}

async function appendNegatingEvent(input: { clinicId: number; paymentId: number; amount: string; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey?: string | null }, eventType: "refund" | "reversal"): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const priorId = await priorTransitionEntityId(db as unknown as DbLike, "payment", input.clinicId, input.idempotencyKey);
    if (priorId != null) return eventType === "refund" ? { status: "refunded", paymentId: priorId } : { status: "reversed", paymentId: priorId };
    const original = await loadPayment(input.clinicId, input.paymentId);
    if (!original) return { status: "not_found" };
    if (original.eventType !== "payment" || original.status !== "posted") return { status: "not_found" };
    const amountCents = centsOf(input.amount);
    if (amountCents == null || amountCents <= 0) return { status: "invalid_amount" };
    const originalCents = centsOf(original.amount) ?? 0;
    try {
      const result = await (db as unknown as DbLike).transaction(async (tx): Promise<PaymentCommandResult> => {
        // Under the receipt lock, re-read cumulative refunds/reversals and enforce
        // the bound so two concurrent negations cannot both pass.
        await advisoryLock(tx, input.clinicId, input.paymentId);
        const priorNegating = ((await tx.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, input.clinicId), eq(canonicalPayments.reversesPaymentId, input.paymentId))).limit(2000)) as (typeof canonicalPayments.$inferSelect)[])
          .filter((r) => r.clinicId === input.clinicId && r.reversesPaymentId === input.paymentId && (r.eventType === "refund" || r.eventType === "reversal"));
        const priorSum = sumCents(priorNegating.map((r) => centsOf(r.amount) ?? 0));
        if (priorSum >= originalCents) return { status: "already_reversed" };
        if (priorSum + amountCents > originalCents) return { status: "exceeds_original" };
        const [row] = await tx.insert(canonicalPayments).values({
          clinicId: input.clinicId, ancillaryCaseId: original.ancillaryCaseId ?? null, serviceType: original.serviceType ?? null,
          claimId: original.claimId ?? null, invoiceId: original.invoiceId ?? null,
          eventType, paymentType: original.paymentType, status: "posted", currency: original.currency, amount: input.amount,
          reversesPaymentId: input.paymentId, reason: input.reason ?? null, idempotencyKey: input.idempotencyKey ?? null, actorUserId: input.actorUserId, sourceSystem: `payment_${eventType}`,
        }).returning();
        await writeTransition(tx, { entityType: "payment", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: original.ancillaryCaseId ?? null, serviceType: original.serviceType ?? null, fromStatus: "posted", toStatus: eventType, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? eventType, sourceType: `payment_${eventType}`, sourceReference: String(input.paymentId), idempotencyKey: input.idempotencyKey ?? null });
        return (eventType === "refund" ? { status: "refunded", paymentId: row.id as number } : { status: "reversed", paymentId: row.id as number }) as PaymentCommandResult;
      });
      return result;
    } catch (e) { if (isUnique(e)) return { status: "conflict" }; throw e; }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

export type RefundInput = { clinicId: number; paymentId: number; amount: string; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey?: string | null };
export async function refundCanonicalPayment(input: RefundInput): Promise<PaymentCommandResult> { return appendNegatingEvent(input, "refund"); }
export async function reverseCanonicalPayment(input: RefundInput): Promise<PaymentCommandResult> { return appendNegatingEvent(input, "reversal"); }
