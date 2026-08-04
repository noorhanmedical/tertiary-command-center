// Phase 2J — derived balance from the APPEND-ONLY canonical payment ledger (pure,
// integer-cents). Balances are NEVER a mutable stored truth. Only `payment` events
// with status `posted` count as collected; `refund`/`reversal` reduce collected;
// `adjustment` reduces the owed amount. Conflicting/inconsistent ledger → integrity
// conflict (never silently newest, never forced zero/paid). No float arithmetic.

import type { CanonicalPayment } from "@shared/schema/canonicalPayments";
import { toCents, centsToString, sumCents } from "@shared/money";
import type { CanonicalBalance } from "@shared/canonicalFinancialView";

export type BalanceInput = {
  currency: string;
  originalAmountCents: number;   // the claim/invoice charge in cents
  ledger: CanonicalPayment[];    // exact ledger rows for this target (already clinic/target scoped)
};

/** Derive the reconciled balance facets. A currency mismatch or an out-of-range
 *  total is an integrity conflict, not a silent zero. */
export function deriveBalance(input: BalanceInput): CanonicalBalance {
  const zero = centsToString(0);
  const conflict = (code: string): CanonicalBalance => ({
    currency: input.currency, originalAmount: safeStr(input.originalAmountCents), approvedAdjustments: zero, paidAmount: zero,
    refundedAmount: zero, reversedAmount: zero, unappliedAmount: zero, outstandingBalance: zero, overpayment: zero,
    integrity: "conflicting", warnings: [code],
  });
  try {
    const paidC: number[] = [], refundC: number[] = [], reversedC: number[] = [], adjustC: number[] = [], unappliedC: number[] = [];
    for (const p of input.ledger) {
      if (p.currency !== input.currency) return conflict("currency_mismatch");
      let cents: number;
      try { cents = toCents(p.amount); } catch { return conflict("amount_invalid"); }
      // A `payment` counts as collected ONLY when its own status is `posted` — a
      // `failed` OR `reversed` payment row is never collected (a reversed payment's
      // negating `reversal` event carries the offset; counting both would
      // double-negate). Refund/reversal/adjustment are distinct event types below.
      if (p.eventType === "payment") {
        if (p.status !== "posted") continue;
        if (p.claimId == null && p.invoiceId == null) unappliedC.push(cents); // unapplied payment (no target)
        else paidC.push(cents);
      } else if (p.status === "failed") continue; // a failed refund/reversal/adjustment never applies
      else if (p.eventType === "refund") refundC.push(cents);
      else if (p.eventType === "reversal") reversedC.push(cents);
      else if (p.eventType === "adjustment") adjustC.push(cents);
    }
    const paid = sumCents(paidC), refunded = sumCents(refundC), reversed = sumCents(reversedC);
    const adjustments = sumCents(adjustC), unapplied = sumCents(unappliedC);
    const netCollected = paid - refunded - reversed;                 // exact collected toward the target
    const owed = input.originalAmountCents - adjustments;             // charge less approved adjustments
    const remaining = owed - netCollected;
    const outstanding = Math.max(0, remaining);
    const overpayment = Math.max(0, -remaining);
    return {
      currency: input.currency,
      originalAmount: centsToString(input.originalAmountCents),
      approvedAdjustments: centsToString(adjustments),
      paidAmount: centsToString(paid),
      refundedAmount: centsToString(refunded),
      reversedAmount: centsToString(reversed),
      unappliedAmount: centsToString(unapplied),
      outstandingBalance: centsToString(outstanding),
      overpayment: centsToString(overpayment),
      integrity: "resolved", warnings: [],
    };
  } catch { return conflict("balance_out_of_range"); }
}

function safeStr(cents: number): string { try { return centsToString(cents); } catch { return "0.00"; } }

// ─── Effective allocation math (allocation-specific negations) ───────────────
export type AllocationRow = { eventType: string; amount: string; parentAllocationId?: number | null; id?: number };
/** EFFECTIVE net applied to a target = Σ apply − Σ (refund + reversal). Adjustment
 *  rows shift owed, handled by the caller. Throws on malformed money. */
export function netAppliedCents(allocs: AllocationRow[]): number {
  const applies = allocs.filter((a) => a.eventType === "apply").map((a) => toCents(a.amount));
  const negs = allocs.filter((a) => a.eventType === "refund" || a.eventType === "reversal").map((a) => toCents(a.amount));
  return sumCents(applies) - sumCents(negs);
}
/** Remaining negatable amount of ONE parent apply-allocation = its amount − Σ of the
 *  refund/reversal rows that name it. Never below zero. */
export function parentNegationRemainingCents(parent: { id: number; amount: string }, allocs: AllocationRow[]): number {
  const applied = toCents(parent.amount);
  const negated = sumCents(allocs.filter((a) => (a.eventType === "refund" || a.eventType === "reversal") && a.parentAllocationId === parent.id).map((a) => toCents(a.amount)));
  return Math.max(0, applied - negated);
}

// ─── Payment allocation validators (pure) ────────────────────────────────────
export type AllocationCheck = { ok: true } | { ok: false; code: string };

/** An allocation may apply a payment to its target only within the same clinic +
 *  case, in the target currency, and not exceeding the payment amount or the target
 *  outstanding unless explicitly represented as overpayment. */
export function validateAllocation(args: {
  paymentClinicId: number; targetClinicId: number;
  paymentAncillaryCaseId: number | null; targetAncillaryCaseId: number | null;
  paymentCurrency: string; targetCurrency: string;
  amountCents: number; paymentRemainingCents: number; targetOutstandingCents: number;
  allowOverpayment?: boolean;
}): AllocationCheck {
  if (args.paymentClinicId !== args.targetClinicId) return { ok: false, code: "allocation_cross_clinic" };
  if (args.paymentAncillaryCaseId != null && args.targetAncillaryCaseId != null && args.paymentAncillaryCaseId !== args.targetAncillaryCaseId) return { ok: false, code: "allocation_wrong_case" };
  if (args.paymentCurrency !== args.targetCurrency) return { ok: false, code: "allocation_currency_mismatch" };
  if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) return { ok: false, code: "allocation_amount_invalid" };
  if (args.amountCents > args.paymentRemainingCents) return { ok: false, code: "allocation_exceeds_payment" };
  if (args.amountCents > args.targetOutstandingCents && !args.allowOverpayment) return { ok: false, code: "allocation_exceeds_outstanding" };
  return { ok: true };
}
