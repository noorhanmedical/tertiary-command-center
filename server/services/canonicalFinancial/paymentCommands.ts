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
import { canonicalPaymentsRuntimeEnabled } from "../../lib/featureFlags";
import { toCents, sumCents } from "@shared/money";
import { validateAllocation, netAppliedCents, parentNegationRemainingCents } from "./balance";
import { isFinancialMigration, writeTransition, idempotentReplay, priorTransitionEntityId, commandFingerprint, verifyCanonicalIdentity, SUPPORTED_CURRENCIES, nonEmpty, type DbLike } from "./commandSupport";

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
  | { status: "parent_allocation_invalid" }
  | { status: "exceeds_original" }
  | { status: "already_reversed" }
  | { status: "conflict" }
  | { status: "idempotency_conflict" }
  | { status: "migration_missing" }
  | { status: "persistence_failed" };

async function loadPayment(clinicId: number, paymentId: number) {
  const rows = await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, clinicId), eq(canonicalPayments.id, paymentId))).limit(2);
  return rows.find((r) => r.id === paymentId && r.clinicId === clinicId) ?? null;
}
async function allocationsForPayment(h: DbLike, clinicId: number, paymentId: number) {
  return ((await h.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), eq(canonicalPaymentAllocations.paymentId, paymentId))).limit(2000)) as (typeof canonicalPaymentAllocations.$inferSelect)[]).filter((r) => r.clinicId === clinicId && r.paymentId === paymentId);
}
async function allocationsForTarget(h: DbLike, clinicId: number, targetType: string, targetId: number) {
  return ((await h.select().from(canonicalPaymentAllocations).where(and(eq(canonicalPaymentAllocations.clinicId, clinicId), eq(canonicalPaymentAllocations.targetType, targetType), eq(canonicalPaymentAllocations.targetId, targetId))).limit(2000)) as (typeof canonicalPaymentAllocations.$inferSelect)[]).filter((r) => r.clinicId === clinicId && r.targetType === targetType && r.targetId === targetId);
}
async function advisoryLock(tx: DbLike, k1: number, k2: number) { await tx.execute(sql`SELECT pg_advisory_xact_lock(${k1}, ${k2})`); }
/** Receipt available (unapplied) balance = amount − Σ apply allocations. */
function receiptApplied(allocs: (typeof canonicalPaymentAllocations.$inferSelect)[]): number { return sumCents(allocs.filter((a) => a.eventType === "apply").map((a) => centsOf(a.amount) ?? 0)); }

export type RecordPaymentInput = {
  clinicId: number; ancillaryCaseId?: number | null; serviceType?: string | null;
  paymentType: string; currency: string; amount: string; externalTransactionId?: string | null;
  receivedAt?: Date | null; actorUserId: string; actorRole: string; sourceSystem: string; idempotencyKey?: string | null;
};

export async function recordCanonicalPayment(input: RecordPaymentInput): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const fp = commandFingerprint({ action: "record_payment", clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, paymentType: input.paymentType, currency: input.currency, amount: input.amount, externalTransactionId: input.externalTransactionId });
    const replay = await idempotentReplay(db as unknown as DbLike, "payment", input.clinicId, input.idempotencyKey, fp);
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", paymentId: replay.entityId };
    if (nonEmpty(input.externalTransactionId)) {
      const dup = (await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, input.clinicId), eq(canonicalPayments.externalTransactionId, input.externalTransactionId as string))).limit(1)).find((r) => r.clinicId === input.clinicId && r.externalTransactionId === input.externalTransactionId);
      if (dup) return { status: "reused", paymentId: dup.id };
    }
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
        const byKey = await priorTransitionEntityId(db as unknown as DbLike, "payment", input.clinicId, input.idempotencyKey);
        if (byKey != null) return { status: "reused", paymentId: byKey };
        if (nonEmpty(input.externalTransactionId)) { const dup = (await db.select().from(canonicalPayments).where(and(eq(canonicalPayments.clinicId, input.clinicId), eq(canonicalPayments.externalTransactionId, input.externalTransactionId as string))).limit(1)).find((r) => r.externalTransactionId === input.externalTransactionId); if (dup) return { status: "reused", paymentId: dup.id }; }
      }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

async function loadTargetClaim(clinicId: number, id: number) {
  const rows = await db.select().from(canonicalClaims).where(and(eq(canonicalClaims.clinicId, clinicId), eq(canonicalClaims.id, id))).limit(2);
  const c = rows.find((r) => r.id === id && r.clinicId === clinicId); if (!c) return null;
  return { clinicId: c.clinicId, ancillaryCaseId: c.ancillaryCaseId ?? null, serviceType: c.serviceType, currency: c.currency, totalCents: centsOf(c.chargeAmount) ?? 0, status: c.canonicalStatus, supersededAt: c.supersededAt, payable: CLAIM_PAYABLE.has(c.canonicalStatus) };
}
async function loadTargetInvoice(clinicId: number, id: number) {
  const rows = await db.select().from(canonicalInvoices).where(and(eq(canonicalInvoices.clinicId, clinicId), eq(canonicalInvoices.id, id))).limit(2);
  const i = rows.find((r) => r.id === id && r.clinicId === clinicId); if (!i) return null;
  return { clinicId: i.clinicId, ancillaryCaseId: i.ancillaryCaseId ?? null, serviceType: i.serviceType, currency: i.currency, totalCents: centsOf(i.totalAmount) ?? 0, status: i.canonicalStatus, supersededAt: i.supersededAt, payable: INVOICE_PAYABLE.has(i.canonicalStatus) };
}

export type AllocateInput = { clinicId: number; paymentId: number; targetType: "claim" | "invoice"; targetId: number; amount: string; isOverpayment?: boolean; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey?: string | null };

export async function allocateCanonicalPayment(input: AllocateInput): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const fp = commandFingerprint({ action: "allocate_payment", clinicId: input.clinicId, paymentId: input.paymentId, targetType: input.targetType, targetId: input.targetId, amount: input.amount, isOverpayment: input.isOverpayment === true });
    const replay = await idempotentReplay(db as unknown as DbLike, "allocation", input.clinicId, input.idempotencyKey, fp);
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return { status: "reused", allocationId: replay.entityId };
    const payment = await loadPayment(input.clinicId, input.paymentId);
    if (!payment) return { status: "not_found" };
    if (payment.eventType !== "payment" || payment.status !== "posted") return { status: "target_not_payable" };
    const amountCents = centsOf(input.amount);
    if (amountCents == null || amountCents <= 0) return { status: "invalid_amount" };
    const target = input.targetType === "claim" ? await loadTargetClaim(input.clinicId, input.targetId) : await loadTargetInvoice(input.clinicId, input.targetId);
    if (!target) return { status: "target_not_found" };
    if (!target.payable || target.supersededAt != null) return { status: "target_not_payable" };
    const paymentCents = centsOf(payment.amount) ?? 0;
    const targetCode = input.targetType === "invoice" ? 1 : 2;
    try {
      const result = await (db as unknown as DbLike).transaction(async (tx): Promise<PaymentCommandResult> => {
        await advisoryLock(tx, input.clinicId, input.paymentId);
        await advisoryLock(tx, input.targetId, targetCode);
        const paymentRemaining = paymentCents - receiptApplied(await allocationsForPayment(tx, input.clinicId, input.paymentId));
        const targetAllocs = await allocationsForTarget(tx, input.clinicId, input.targetType, input.targetId);
        const targetOutstanding = Math.max(0, target.totalCents - netAppliedCents(targetAllocs));
        const check = validateAllocation({
          paymentClinicId: input.clinicId, targetClinicId: target.clinicId,
          paymentAncillaryCaseId: payment.ancillaryCaseId ?? null, targetAncillaryCaseId: target.ancillaryCaseId ?? null,
          paymentCurrency: payment.currency, targetCurrency: target.currency,
          amountCents, paymentRemainingCents: paymentRemaining, targetOutstandingCents: targetOutstanding, allowOverpayment: input.isOverpayment === true,
        });
        if (!check.ok) return { status: "allocation_rejected", code: check.code };
        const derived = (netAppliedCents(targetAllocs) + amountCents) >= target.totalCents ? "paid" : "partially_paid";
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
      if (isUnique(e)) { const byKey = await priorTransitionEntityId(db as unknown as DbLike, "allocation", input.clinicId, input.idempotencyKey); if (byKey != null) return { status: "reused", allocationId: byKey }; }
      throw e;
    }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

// §9 — allocation-specific negation (refund/reversal). Names an EXACT parent apply
// allocation; bounded by that parent's remaining applied amount; reopens the target.
export type NegateInput = { clinicId: number; paymentId: number; allocationId: number; amount: string; reason?: string | null; actorUserId: string; actorRole: string; idempotencyKey?: string | null };

async function negateAllocation(input: NegateInput, eventType: "refund" | "reversal"): Promise<PaymentCommandResult> {
  if (!canonicalPaymentsRuntimeEnabled()) return { status: "skipped_flag_off" };
  try {
    const fp = commandFingerprint({ action: `${eventType}_allocation`, clinicId: input.clinicId, paymentId: input.paymentId, allocationId: input.allocationId, amount: input.amount });
    const replay = await idempotentReplay(db as unknown as DbLike, "allocation", input.clinicId, input.idempotencyKey, fp);
    if (replay.kind === "conflict") return { status: "idempotency_conflict" };
    if (replay.kind === "replay") return eventType === "refund" ? { status: "refunded", allocationId: replay.entityId } : { status: "reversed", allocationId: replay.entityId };
    const amountCents = centsOf(input.amount);
    if (amountCents == null || amountCents <= 0) return { status: "invalid_amount" };
    const targetCode = 3;
    try {
      const result = await (db as unknown as DbLike).transaction(async (tx): Promise<PaymentCommandResult> => {
        await advisoryLock(tx, input.clinicId, input.paymentId);
        const all = await allocationsForPayment(tx, input.clinicId, input.paymentId);
        const parent = all.find((a) => a.id === input.allocationId && a.eventType === "apply" && a.paymentId === input.paymentId && a.clinicId === input.clinicId);
        if (!parent) return { status: "parent_allocation_invalid" };
        await advisoryLock(tx, parent.targetId, targetCode);
        const remaining = parentNegationRemainingCents({ id: parent.id, amount: parent.amount }, all);
        if (remaining <= 0) return { status: "already_reversed" };
        if (amountCents > remaining) return { status: "exceeds_original" };
        const [row] = await tx.insert(canonicalPaymentAllocations).values({
          paymentId: input.paymentId, clinicId: input.clinicId, ancillaryCaseId: parent.ancillaryCaseId ?? null, serviceType: parent.serviceType ?? null,
          eventType, parentAllocationId: parent.id, targetType: parent.targetType, targetId: parent.targetId, currency: parent.currency, amount: input.amount,
          reason: input.reason ?? null, idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp, actorUserId: input.actorUserId, sourceSystem: `payment_${eventType}`,
        }).returning();
        // Reopen the target: derive its status from the NEW effective net applied.
        const targetAllocs = await allocationsForTarget(tx, input.clinicId, parent.targetType, parent.targetId);
        const net = netAppliedCents(targetAllocs); // includes the just-inserted negation
        const target = parent.targetType === "claim" ? await loadTargetClaim(input.clinicId, parent.targetId) : await loadTargetInvoice(input.clinicId, parent.targetId);
        if (target && target.supersededAt == null) {
          const derived = net <= 0 ? (parent.targetType === "invoice" ? "issued" : "submitted") : net >= target.totalCents ? "paid" : "partially_paid";
          const tbl = parent.targetType === "claim" ? canonicalClaims : canonicalInvoices;
          // FAIL CLOSED like the apply path: gate on the exact current status and
          // require exactly one affected row — else roll back the whole negation.
          const upd = await tx.update(tbl as never).set({ canonicalStatus: derived, updatedAt: new Date() } as never)
            .where(and(eq((tbl as typeof canonicalClaims).id, parent.targetId), eq((tbl as typeof canonicalClaims).clinicId, input.clinicId), eq((tbl as typeof canonicalClaims).canonicalStatus, target.status), isNull((tbl as typeof canonicalClaims).supersededAt))).returning();
          if ((upd as unknown[]).length !== 1) throw Object.assign(new Error("target_update_conflict"), { code: "TARGET_UPDATE_CONFLICT" });
        }
        await writeTransition(tx, { entityType: "allocation", entityId: row.id as number, clinicId: input.clinicId, ancillaryCaseId: parent.ancillaryCaseId ?? null, serviceType: parent.serviceType ?? null, fromStatus: "apply", toStatus: eventType, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? eventType, sourceType: `payment_${eventType}`, sourceReference: String(parent.id), idempotencyKey: input.idempotencyKey ?? null, commandFingerprint: fp });
        return (eventType === "refund" ? { status: "refunded", allocationId: row.id as number } : { status: "reversed", allocationId: row.id as number }) as PaymentCommandResult;
      });
      return result;
    } catch (e) { if ((e as { code?: string })?.code === "TARGET_UPDATE_CONFLICT") return { status: "conflict" }; if (isUnique(e)) return { status: "conflict" }; throw e; }
  } catch (e) { if (isFinancialMigration(e)) return { status: "migration_missing" }; return { status: "persistence_failed" }; }
}

export function refundCanonicalPayment(input: NegateInput): Promise<PaymentCommandResult> { return negateAllocation(input, "refund"); }
export function reverseCanonicalPayment(input: NegateInput): Promise<PaymentCommandResult> { return negateAllocation(input, "reversal"); }
