// Phase 2J — shared allocation LINEAGE validator (read model + stage + commands).
//
// An `apply` row must point at an exact receipt + target within the same clinic /
// case / service / currency with a positive amount. A `refund`/`reversal` row must
// additionally name an EXACT parent apply-allocation whose payment + target-type +
// target-id + clinic / case / service / currency all match, and the cumulative
// negation per parent may never exceed the parent's applied amount. A malformed row
// yields an integrity conflict and must NEVER change a derived balance or stage.

import { toCents, sumCents } from "@shared/money";

export type AllocRow = {
  id?: number; paymentId?: number | null; clinicId?: number | null; ancillaryCaseId?: number | null; serviceType?: string | null;
  eventType?: string | null; parentAllocationId?: number | null; targetType?: string | null; targetId?: number | null;
  currency?: string | null; amount?: string | null;
};
export type TargetRef = { clinicId: number; targetType: "claim" | "invoice"; targetId: number; currency: string; ancillaryCaseId?: number | null; serviceType?: string | null };
export type ReceiptRow = { id?: number; clinicId?: number | null; eventType?: string | null; status?: string | null; currency?: string | null; ancillaryCaseId?: number | null; serviceType?: string | null };
export type LineageResult = { ok: true } | { ok: false; code: string };
const cents = (v: unknown): number | null => { try { return toCents(v as string); } catch { return null; } };

/** Validate the COMPLETE allocation set for one exact target. Every apply/negation
 *  must match the target's clinic/type/id/currency; negations must name an apply
 *  parent IN THIS SET (same target) and not exceed it cumulatively. When a receipts
 *  map is supplied, each apply's actual payment receipt is verified (§4): it must
 *  exist, be a POSTED payment (never pending/failed), and agree on clinic/case/
 *  service/currency — an orphaned/failed/pending receipt never counts. */
export function validateTargetAllocationSet(allocs: AllocRow[], target: TargetRef, receipts?: Map<number, ReceiptRow>): LineageResult {
  const applies = new Map<number, AllocRow>();
  for (const a of allocs) {
    if (a.clinicId !== target.clinicId) return { ok: false, code: "allocation_wrong_clinic" };
    if (a.targetType !== target.targetType || a.targetId !== target.targetId) return { ok: false, code: "allocation_wrong_target" };
    if ((a.currency ?? null) !== target.currency) return { ok: false, code: "allocation_currency_mismatch" };
    if (target.ancillaryCaseId != null && a.ancillaryCaseId != null && a.ancillaryCaseId !== target.ancillaryCaseId) return { ok: false, code: "allocation_wrong_case" };
    if (target.serviceType != null && a.serviceType != null && a.serviceType !== target.serviceType) return { ok: false, code: "allocation_wrong_service" };
    const c = cents(a.amount);
    if (c == null || c <= 0) return { ok: false, code: "allocation_amount_invalid" };
    // §4 verify the actual receipt for this allocation when supplied.
    if (receipts) {
      const rcpt = a.paymentId != null ? receipts.get(a.paymentId) : undefined;
      if (!rcpt) return { ok: false, code: "allocation_receipt_missing" };
      if (rcpt.eventType !== "payment") return { ok: false, code: "allocation_receipt_not_payment" };
      if (rcpt.status !== "posted") return { ok: false, code: "allocation_receipt_not_posted" };
      if ((rcpt.clinicId ?? null) !== a.clinicId) return { ok: false, code: "allocation_receipt_wrong_clinic" };
      if ((rcpt.currency ?? null) !== (a.currency ?? null)) return { ok: false, code: "allocation_receipt_currency_mismatch" };
      if (target.ancillaryCaseId != null && rcpt.ancillaryCaseId != null && rcpt.ancillaryCaseId !== target.ancillaryCaseId) return { ok: false, code: "allocation_receipt_wrong_case" };
      if (target.serviceType != null && rcpt.serviceType != null && rcpt.serviceType !== target.serviceType) return { ok: false, code: "allocation_receipt_wrong_service" };
    }
    if (a.eventType === "apply") { if (a.id != null) applies.set(a.id, a); }
    // Only apply/refund/reversal are modeled today. `adjustment` has no command path
    // and no bound here → fail closed until one exists (never silently reduce owed).
    else if (a.eventType !== "refund" && a.eventType !== "reversal") return { ok: false, code: "allocation_event_type_invalid" };
  }
  // Negations must name an exact parent apply in this set, and not over-negate it.
  const negatedByParent = new Map<number, number>();
  for (const a of allocs) {
    if (a.eventType !== "refund" && a.eventType !== "reversal") continue;
    const pid = a.parentAllocationId ?? null;
    if (pid == null) return { ok: false, code: "negation_parent_missing" };
    const parent = applies.get(pid);
    if (!parent) return { ok: false, code: "negation_parent_invalid" };
    if ((a.paymentId ?? null) !== (parent.paymentId ?? null)) return { ok: false, code: "negation_parent_payment_mismatch" };
    if (a.targetType !== parent.targetType || a.targetId !== parent.targetId) return { ok: false, code: "negation_parent_target_mismatch" };
    negatedByParent.set(pid, (negatedByParent.get(pid) ?? 0) + (cents(a.amount) ?? 0));
  }
  for (const [pid, negated] of negatedByParent) {
    const parent = applies.get(pid)!;
    if (negated > (cents(parent.amount) ?? 0)) return { ok: false, code: "negation_exceeds_parent" };
  }
  return { ok: true };
}

/** Validate a SINGLE proposed negation against its exact parent + receipt + target
 *  (used by the refund/reversal command before inserting). */
export function validateNegationLineage(args: {
  parent: AllocRow; paymentId: number; clinicId: number; amountCents: number;
  payment: { clinicId: number; ancillaryCaseId: number | null; serviceType: string | null; currency: string } | null;
  target: { clinicId: number; ancillaryCaseId: number | null; serviceType: string | null; currency: string } | null;
  priorNegatedCents: number;
}): LineageResult {
  const p = args.parent;
  if (p.eventType !== "apply") return { ok: false, code: "negation_parent_invalid" };
  if ((p.paymentId ?? null) !== args.paymentId || p.clinicId !== args.clinicId) return { ok: false, code: "negation_parent_payment_mismatch" };
  if (!args.payment || !args.target) return { ok: false, code: "negation_target_missing" };
  if (args.payment.clinicId !== args.clinicId || args.target.clinicId !== args.clinicId) return { ok: false, code: "allocation_wrong_clinic" };
  if ((p.currency ?? null) !== args.target.currency || args.payment.currency !== args.target.currency) return { ok: false, code: "allocation_currency_mismatch" };
  if (args.payment.ancillaryCaseId != null && args.target.ancillaryCaseId != null && args.payment.ancillaryCaseId !== args.target.ancillaryCaseId) return { ok: false, code: "allocation_wrong_case" };
  if (args.payment.serviceType != null && args.target.serviceType != null && args.payment.serviceType !== args.target.serviceType) return { ok: false, code: "allocation_wrong_service" };
  if (args.amountCents <= 0) return { ok: false, code: "invalid_amount" };
  const parentCents = cents(p.amount);
  if (parentCents == null) return { ok: false, code: "allocation_amount_invalid" };
  if (args.priorNegatedCents >= parentCents) return { ok: false, code: "already_reversed" };
  if (args.priorNegatedCents + args.amountCents > parentCents) return { ok: false, code: "exceeds_original" };
  return { ok: true };
}

export function sumNegationsForParent(allocs: AllocRow[], parentId: number): number {
  return sumCents(allocs.filter((a) => (a.eventType === "refund" || a.eventType === "reversal") && a.parentAllocationId === parentId).map((a) => cents(a.amount) ?? 0));
}
