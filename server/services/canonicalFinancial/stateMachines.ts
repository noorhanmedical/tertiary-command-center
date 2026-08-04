// Phase 2J — server-owned claim + invoice state machines (pure validators).
//
// Explicit allowed transitions only; unsupported transitions are a conflict.
// Submitted claims and issued invoices are immutable historical states — a
// correction creates a NEW attempt/version (never a mutation). A `submitted`
// claim status may be persisted ONLY from an exact authorized source.

import { CANONICAL_CLAIM_SUBMISSION_SOURCES, type CanonicalClaimStatus, type CanonicalClaimSubmissionSource } from "@shared/schema/canonicalClaims";
import type { CanonicalInvoiceStatus } from "@shared/schema/canonicalInvoices";

// ─── Claim ───────────────────────────────────────────────────────────────────
const CLAIM_TRANSITIONS: Record<CanonicalClaimStatus, CanonicalClaimStatus[]> = {
  not_ready: ["ready", "voided", "superseded"],
  ready: ["draft", "not_ready", "voided", "superseded"],
  draft: ["queued", "ready", "voided", "superseded"],
  queued: ["submitted", "draft", "voided", "superseded"],
  // Submitted (and beyond) are immutable except adjudication results + payment
  // application; corrections go through a NEW attempt (supersedes lineage).
  submitted: ["accepted", "rejected", "denied", "partially_paid", "paid"],
  accepted: ["partially_paid", "paid", "denied"],
  rejected: [],
  denied: [],
  partially_paid: ["paid", "denied"],
  paid: [],
  voided: [],
  superseded: [],
};
// Statuses that are immutable historical records (never edited in place).
export const CLAIM_IMMUTABLE_SUBMITTED = new Set<CanonicalClaimStatus>(["submitted", "accepted", "rejected", "denied", "partially_paid", "paid"]);

export function canTransitionClaim(from: CanonicalClaimStatus, to: CanonicalClaimStatus): boolean {
  return (CLAIM_TRANSITIONS[from] ?? []).includes(to);
}
/** A `submitted` status requires an exact authorized source (never a button click). */
export function claimSubmissionSourceValid(source: string | null | undefined): source is CanonicalClaimSubmissionSource {
  return typeof source === "string" && (CANONICAL_CLAIM_SUBMISSION_SOURCES as readonly string[]).includes(source);
}
/** An evidence-fingerprint change supersedes ONLY an unsubmitted claim (draft/queued/
 *  ready/not_ready). A submitted historical claim is NEVER rewritten. */
export function evidenceChangeSupersedes(status: CanonicalClaimStatus, oldFingerprint: string | null, newFingerprint: string | null): boolean {
  if (CLAIM_IMMUTABLE_SUBMITTED.has(status) || status === "voided" || status === "superseded") return false;
  return (oldFingerprint ?? null) !== (newFingerprint ?? null);
}

// ─── Invoice ─────────────────────────────────────────────────────────────────
const INVOICE_TRANSITIONS: Record<CanonicalInvoiceStatus, CanonicalInvoiceStatus[]> = {
  draft: ["approved", "voided", "superseded"],
  approved: ["issued", "voided", "superseded"],
  // Issued invoices are immutable — corrections create a new version/credit.
  issued: ["delivered", "delivery_failed", "partially_paid", "paid", "voided"],
  delivered: ["partially_paid", "paid", "voided"],
  delivery_failed: ["delivered", "voided"],
  partially_paid: ["paid", "voided"],
  paid: [],
  voided: [],
  superseded: [],
};
export const INVOICE_IMMUTABLE_ISSUED = new Set<CanonicalInvoiceStatus>(["issued", "delivered", "partially_paid", "paid"]);

export function canTransitionInvoice(from: CanonicalInvoiceStatus, to: CanonicalInvoiceStatus): boolean {
  return (INVOICE_TRANSITIONS[from] ?? []).includes(to);
}
/** `delivered` requires an exact delivery event reference; `paid` requires exact
 *  allocated payment evidence (checked by the caller against the ledger). */
export function invoiceDeliveredRequiresEvent(to: CanonicalInvoiceStatus, deliveryEventReference: string | null | undefined): boolean {
  return to !== "delivered" || (typeof deliveryEventReference === "string" && deliveryEventReference.trim().length > 0);
}
