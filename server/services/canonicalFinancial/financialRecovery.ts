// Phase 2J — EXECUTABLE canonical financial recovery functions (not list-only).
//
// Each recovery is bound to an EXACT failure descriptor (clinic + entity + action +
// idempotency key) and re-invokes the corresponding IDEMPOTENT command, so a retry
// is exactly-once and never double-applies. Recoveries are flag-gated and perform
// ONLY the exact requested action — no broad case-level resolution, no resolution
// after partial success (the underlying command's affected-row + idempotency
// guarantees enforce that). PHI-free. This module contains the recovery FUNCTIONS;
// no auto-worker executes them here (retry apply is intentionally not run).

import { createOrReuseCanonicalInvoiceDraft } from "./invoiceCommands";
import { transitionCanonicalClaim } from "./claimCommands";
import { allocateCanonicalPayment } from "./paymentCommands";
import type { CanonicalClaimStatus } from "@shared/schema/canonicalClaims";

export const CANONICAL_FINANCIAL_RECOVERY_ACTIONS = [
  "create_invoice_from_claim", "transition_claim_from_exact_source", "apply_payment_allocation",
] as const;
export type CanonicalFinancialRecoveryAction = (typeof CANONICAL_FINANCIAL_RECOVERY_ACTIONS)[number];

export type RecoveryFailure = {
  action: CanonicalFinancialRecoveryAction;
  clinicId: number;
  actorUserId: string;
  actorRole: string;
  idempotencyKey: string;         // the EXACT failing command's key — replay is idempotent
  // exact per-action inputs
  claimId?: number;
  invoiceRecipientType?: string; invoiceRecipientId?: string; invoiceType?: string;
  transition?: CanonicalClaimStatus; sourceType?: string; sourceReference?: string; reason?: string;
  paymentId?: number; targetType?: "claim" | "invoice"; targetId?: number; amount?: string;
};

/** Execute ONE exact recovery. Returns the underlying command result verbatim
 *  (its status doubles as the recovery outcome). Idempotent — a prior success
 *  returns `reused`/`transitioned` without a second write. */
export async function executeCanonicalFinancialRecovery(f: RecoveryFailure): Promise<{ status: string } & Record<string, unknown>> {
  switch (f.action) {
    case "create_invoice_from_claim":
      if (f.claimId == null || !f.invoiceRecipientType || !f.invoiceRecipientId) return { status: "invalid_recovery_input" };
      return createOrReuseCanonicalInvoiceDraft({ clinicId: f.clinicId, claimId: f.claimId, invoiceType: f.invoiceType ?? "patient", recipientType: f.invoiceRecipientType, recipientId: f.invoiceRecipientId, actorUserId: f.actorUserId, actorRole: f.actorRole, idempotencyKey: f.idempotencyKey });
    case "transition_claim_from_exact_source":
      if (f.claimId == null || !f.transition) return { status: "invalid_recovery_input" };
      return transitionCanonicalClaim({ clinicId: f.clinicId, claimId: f.claimId, transition: f.transition, sourceType: f.sourceType ?? null, sourceReference: f.sourceReference ?? null, reason: f.reason ?? null, actorUserId: f.actorUserId, actorRole: f.actorRole, idempotencyKey: f.idempotencyKey });
    case "apply_payment_allocation":
      if (f.paymentId == null || !f.targetType || f.targetId == null || !f.amount) return { status: "invalid_recovery_input" };
      return allocateCanonicalPayment({ clinicId: f.clinicId, paymentId: f.paymentId, targetType: f.targetType, targetId: f.targetId, amount: f.amount, reason: f.reason ?? null, actorUserId: f.actorUserId, actorRole: f.actorRole, idempotencyKey: f.idempotencyKey });
    default:
      return { status: "unknown_recovery_action" };
  }
}
