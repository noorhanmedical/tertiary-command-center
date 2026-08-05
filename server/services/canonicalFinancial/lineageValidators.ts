// Phase 2J — shared batched CLAIM/INVOICE lineage validators (read model + stage).
//
// Revalidates a persisted financial row against the CURRENT exact canonical context
// (identity + evidence + version + money + provenance), so a row that was valid at
// creation but is now stale (membership deactivated, global patient merged, evidence
// superseded, Billing Document / readiness drift, line-item or total drift, invoice
// disagrees with its claim) is surfaced as an integrity conflict rather than a false
// canonical result. Pure — the caller batch-loads context; no N+1.

import { toCents, reconcileLines, type MoneyLine } from "@shared/money";
import { CANONICAL_CLAIM_REQUIRED_FIELDS } from "@shared/schema/canonicalClaims";
import { CANONICAL_INVOICE_TYPES, CANONICAL_INVOICE_RECIPIENT_TYPES } from "@shared/schema/canonicalInvoices";

const ACTIVE_IDENTITY = new Set(["active", "current"]);
const CLAIM_SUBMITTED_PLUS = new Set(["submitted", "accepted", "rejected", "denied", "partially_paid", "paid"]);
const SUPPORTED_CURRENCIES = new Set(["USD"]);
const INVOICE_TYPES = new Set<string>(CANONICAL_INVOICE_TYPES);
const INVOICE_RECIPIENT_TYPES = new Set<string>(CANONICAL_INVOICE_RECIPIENT_TYPES);

const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const centsOf = (v: unknown): number | null => { try { return toCents(v as string); } catch { return null; } };
const asLines = (v: unknown): MoneyLine[] => (Array.isArray(v) ? (v as MoneyLine[]) : []);
/** Canonical {lineId → cents} set for exact line equality between claim and invoice. */
function lineKeySet(lines: MoneyLine[]): string | null {
  const parts: string[] = [];
  for (const l of lines) {
    if (!l || typeof l.lineId !== "string") return null;
    const c = centsOf(l.amount);
    if (c == null) return null;
    parts.push(`${l.lineId}=${c}`);
  }
  return parts.sort().join("|");
}

export type LineageVerdict = { ok: true } | { ok: false; code: string };

export type ClaimLineageRow = {
  id?: number; clinicId: number; ancillaryCaseId: number | null; serviceType: string;
  globalPlexusPatientId: number | null; patientClinicMembershipId: number | null;
  billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null;
  orderNoteDocumentReferenceId: number | null; reportDocumentReferenceId: number | null; procedureNoteDocumentReferenceId: number | null;
  procedureEventId: number | null; canonicalStatus: string; attemptNumber: number | null; supersedesClaimId: number | null;
  currency: string; chargeAmount: string | null; lineItems: unknown; fieldProvenance: unknown;
  submittedAt: unknown; submissionSource: string | null; submissionActorUserId?: string | null; submissionReference?: string | null;
};

type EvidenceHolder = {
  clinicId: number | null; ancillaryCaseId: number | null; serviceType: string; supersededAt: unknown;
  evidenceFingerprint: string | null; procedureEventId: number | null;
  orderNoteDocumentReferenceId: number | null; reportDocumentReferenceId: number | null; procedureNoteDocumentReferenceId: number | null;
  globalPlexusPatientId: number | null; patientClinicMembershipId: number | null;
};
export type ClaimLineageCtx = {
  case?: { clinicId: number; serviceType: string } | null;
  membership?: { clinicId: number; membershipStatus: string; globalPlexusPatientId: number | null } | null;
  globalPatient?: { identityStatus: string; mergedIntoPatientId: number | null } | null;
  readiness?: EvidenceHolder | null;
  billingDocument?: (EvidenceHolder & { billingReadinessCheckId: number | null }) | null;
  parentClaim?: { clinicId: number; ancillaryCaseId: number | null; serviceType: string; attemptNumber: number | null } | null;
};
// Back-compat alias (old name).
export type IdentityCtx = ClaimLineageCtx;

/** Revalidate one claim against the current case + verified identity + evidence
 *  lineage (Billing Document + readiness) + money truth + provenance + version. */
export function validateClaimLineage(claim: ClaimLineageRow, ctx: ClaimLineageCtx): LineageVerdict {
  // ── identity ──
  if (claim.ancillaryCaseId == null) return { ok: false, code: "claim_case_missing" };
  if (!ctx.case) return { ok: false, code: "claim_case_not_found" };
  if (ctx.case.clinicId !== claim.clinicId || ctx.case.serviceType !== claim.serviceType) return { ok: false, code: "claim_case_mismatch" };
  if (claim.patientClinicMembershipId == null || claim.globalPlexusPatientId == null) return { ok: false, code: "claim_identity_incomplete" };
  const m = ctx.membership;
  if (!m) return { ok: false, code: "claim_membership_not_found" };
  if (m.clinicId !== claim.clinicId) return { ok: false, code: "claim_membership_wrong_clinic" };
  if (m.membershipStatus !== "active") return { ok: false, code: "claim_membership_inactive" };
  if ((m.globalPlexusPatientId ?? null) !== claim.globalPlexusPatientId) return { ok: false, code: "claim_membership_identity_mismatch" };
  const g = ctx.globalPatient;
  if (!g) return { ok: false, code: "claim_global_patient_not_found" };
  if (!ACTIVE_IDENTITY.has(g.identityStatus)) return { ok: false, code: "claim_global_patient_inactive" };
  if (g.mergedIntoPatientId != null) return { ok: false, code: "claim_global_patient_merged" };
  if (!nonEmptyStr(claim.evidenceFingerprint)) return { ok: false, code: "claim_fingerprint_unresolved" };

  // ── money truth ──
  if (!SUPPORTED_CURRENCIES.has(claim.currency)) return { ok: false, code: "claim_currency_unsupported" };
  const chargeCents = centsOf(claim.chargeAmount);
  if (chargeCents == null) return { ok: false, code: "claim_charge_unparseable" };
  const recon = reconcileLines(asLines(claim.lineItems));
  if (!recon.ok) return { ok: false, code: "claim_line_items_invalid" };
  if (recon.totalCents !== chargeCents) return { ok: false, code: "claim_total_mismatch" };

  // ── attempt version + field provenance ──
  if (typeof claim.attemptNumber !== "number" || !Number.isFinite(claim.attemptNumber) || claim.attemptNumber <= 0) return { ok: false, code: "claim_attempt_invalid" };
  const prov = (claim.fieldProvenance && typeof claim.fieldProvenance === "object") ? (claim.fieldProvenance as Record<string, { sourceType?: unknown }>) : {};
  for (const f of CANONICAL_CLAIM_REQUIRED_FIELDS) {
    const cell = prov[f];
    if (!cell || !nonEmptyStr(cell.sourceType)) return { ok: false, code: "claim_field_provenance_missing" };
  }

  // ── Billing Document linkage (exact, current) ──
  if (claim.billingDocumentId == null) return { ok: false, code: "claim_billing_document_missing" };
  const bd = ctx.billingDocument;
  if (!bd) return { ok: false, code: "claim_billing_document_not_found" };
  if (bd.supersededAt != null) return { ok: false, code: "claim_billing_document_superseded" };
  if ((bd.clinicId ?? null) !== claim.clinicId || (bd.ancillaryCaseId ?? null) !== claim.ancillaryCaseId || bd.serviceType !== claim.serviceType) return { ok: false, code: "claim_billing_document_scope_mismatch" };
  if ((bd.billingReadinessCheckId ?? null) !== (claim.billingReadinessCheckId ?? null)) return { ok: false, code: "claim_billing_document_readiness_mismatch" };
  if (!nonEmptyStr(bd.evidenceFingerprint) || bd.evidenceFingerprint !== claim.evidenceFingerprint) return { ok: false, code: "claim_billing_document_fingerprint_mismatch" };
  if ((bd.procedureEventId ?? null) !== (claim.procedureEventId ?? null)) return { ok: false, code: "claim_billing_document_procedure_mismatch" };
  if ((bd.orderNoteDocumentReferenceId ?? null) !== (claim.orderNoteDocumentReferenceId ?? null)
    || (bd.reportDocumentReferenceId ?? null) !== (claim.reportDocumentReferenceId ?? null)
    || (bd.procedureNoteDocumentReferenceId ?? null) !== (claim.procedureNoteDocumentReferenceId ?? null)) return { ok: false, code: "claim_billing_document_reference_mismatch" };
  if ((bd.globalPlexusPatientId ?? null) !== claim.globalPlexusPatientId || (bd.patientClinicMembershipId ?? null) !== claim.patientClinicMembershipId) return { ok: false, code: "claim_billing_document_identity_mismatch" };

  // ── readiness linkage (exact, current) ──
  if (claim.billingReadinessCheckId == null) return { ok: false, code: "claim_readiness_missing" };
  const rd = ctx.readiness;
  if (!rd) return { ok: false, code: "claim_readiness_not_found" };
  if (rd.supersededAt != null) return { ok: false, code: "claim_readiness_superseded" };
  if ((rd.clinicId ?? null) !== claim.clinicId || (rd.ancillaryCaseId ?? null) !== claim.ancillaryCaseId || rd.serviceType !== claim.serviceType) return { ok: false, code: "claim_readiness_scope_mismatch" };
  if (!nonEmptyStr(rd.evidenceFingerprint) || rd.evidenceFingerprint !== claim.evidenceFingerprint) return { ok: false, code: "claim_readiness_fingerprint_mismatch" };
  if ((rd.procedureEventId ?? null) !== (claim.procedureEventId ?? null)
    || (rd.orderNoteDocumentReferenceId ?? null) !== (claim.orderNoteDocumentReferenceId ?? null)
    || (rd.reportDocumentReferenceId ?? null) !== (claim.reportDocumentReferenceId ?? null)
    || (rd.procedureNoteDocumentReferenceId ?? null) !== (claim.procedureNoteDocumentReferenceId ?? null)) return { ok: false, code: "claim_readiness_reference_mismatch" };
  if (rd.globalPlexusPatientId != null && rd.globalPlexusPatientId !== claim.globalPlexusPatientId) return { ok: false, code: "claim_readiness_identity_mismatch" };
  if (rd.patientClinicMembershipId != null && rd.patientClinicMembershipId !== claim.patientClinicMembershipId) return { ok: false, code: "claim_readiness_identity_mismatch" };

  // ── parent-claim family (correction lineage) ──
  if (claim.supersedesClaimId != null) {
    const p = ctx.parentClaim;
    if (!p) return { ok: false, code: "claim_parent_not_found" };
    if (p.clinicId !== claim.clinicId || (p.ancillaryCaseId ?? null) !== claim.ancillaryCaseId || p.serviceType !== claim.serviceType) return { ok: false, code: "claim_parent_scope_mismatch" };
    if (typeof p.attemptNumber !== "number" || p.attemptNumber >= claim.attemptNumber) return { ok: false, code: "claim_parent_attempt_invalid" };
  }

  // ── submitted-or-later requires complete submission provenance ──
  if (CLAIM_SUBMITTED_PLUS.has(claim.canonicalStatus)) {
    if (claim.submittedAt == null || !nonEmptyStr(claim.submissionSource) || !nonEmptyStr(claim.submissionActorUserId) || !nonEmptyStr(claim.submissionReference)) return { ok: false, code: "claim_submission_provenance_missing" };
  }
  return { ok: true };
}

export type InvoiceLineageRow = {
  id?: number; clinicId: number; ancillaryCaseId: number | null; serviceType: string; claimId: number | null;
  billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null;
  canonicalStatus: string; currency: string; totalAmount: string | null; lineItems: unknown;
  invoiceType: string; recipientType: string | null; recipientId: string | null;
  supersedesInvoiceId: number | null; deliveredAt: unknown; deliveryEventReference: string | null;
};
export type InvoiceClaimRow = {
  clinicId: number; ancillaryCaseId: number | null; serviceType: string;
  billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null;
  currency: string; lineItems: unknown;
} | null;
export type InvoiceLineageCtx = {
  claim: InvoiceClaimRow;
  parentInvoice?: { clinicId: number; ancillaryCaseId: number | null; serviceType: string; claimId: number | null } | null;
};

/** Revalidate one invoice against its exact claim (clinic/case/service + evidence
 *  version + currency + exact authorized lines) + type/recipient vocabulary +
 *  parent-invoice family + delivery provenance. Accepts the legacy flat claim ctx
 *  (a bare claim row) OR the new `{ claim, parentInvoice }` shape. */
export function validateInvoiceLineage(inv: InvoiceLineageRow, ctxOrClaim: InvoiceLineageCtx | InvoiceClaimRow): LineageVerdict {
  const ctx: InvoiceLineageCtx = (ctxOrClaim && typeof ctxOrClaim === "object" && "claim" in ctxOrClaim)
    ? (ctxOrClaim as InvoiceLineageCtx)
    : { claim: (ctxOrClaim as InvoiceClaimRow) ?? null, parentInvoice: null };
  const claim = ctx.claim;
  if (inv.claimId == null) return { ok: false, code: "invoice_claim_missing" };
  if (!claim) return { ok: false, code: "invoice_claim_not_found" };
  if (claim.clinicId !== inv.clinicId || (claim.ancillaryCaseId ?? null) !== (inv.ancillaryCaseId ?? null) || claim.serviceType !== inv.serviceType) return { ok: false, code: "invoice_claim_mismatch" };
  if ((claim.billingDocumentId ?? null) !== (inv.billingDocumentId ?? null)) return { ok: false, code: "invoice_billing_document_mismatch" };
  if ((claim.billingReadinessCheckId ?? null) !== (inv.billingReadinessCheckId ?? null)) return { ok: false, code: "invoice_readiness_mismatch" };
  if ((claim.evidenceFingerprint ?? null) !== (inv.evidenceFingerprint ?? null)) return { ok: false, code: "invoice_fingerprint_mismatch" };

  // ── money truth + exact authorized-line equality with the claim ──
  if (claim.currency !== inv.currency) return { ok: false, code: "invoice_currency_mismatch" };
  const totalCents = centsOf(inv.totalAmount);
  if (totalCents == null) return { ok: false, code: "invoice_total_unparseable" };
  const recon = reconcileLines(asLines(inv.lineItems));
  if (!recon.ok) return { ok: false, code: "invoice_line_items_invalid" };
  if (recon.totalCents !== totalCents) return { ok: false, code: "invoice_total_mismatch" };
  const invKey = lineKeySet(asLines(inv.lineItems));
  const claimKey = lineKeySet(asLines(claim.lineItems));
  if (invKey == null || claimKey == null || invKey !== claimKey) return { ok: false, code: "invoice_lines_disagree_with_claim" };

  // ── type / recipient vocabulary ──
  if (!INVOICE_TYPES.has(inv.invoiceType)) return { ok: false, code: "invoice_type_invalid" };
  if (!nonEmptyStr(inv.recipientType) || !INVOICE_RECIPIENT_TYPES.has(inv.recipientType)) return { ok: false, code: "invoice_recipient_type_invalid" };
  if (!nonEmptyStr(inv.recipientId)) return { ok: false, code: "invoice_recipient_id_missing" };

  // ── parent-invoice family (correction lineage) ──
  if (inv.supersedesInvoiceId != null) {
    const p = ctx.parentInvoice;
    if (!p) return { ok: false, code: "invoice_parent_not_found" };
    if (p.clinicId !== inv.clinicId || (p.ancillaryCaseId ?? null) !== (inv.ancillaryCaseId ?? null) || p.serviceType !== inv.serviceType || (p.claimId ?? null) !== (inv.claimId ?? null)) return { ok: false, code: "invoice_parent_mismatch" };
  }

  // ── delivery provenance ──
  if (inv.canonicalStatus === "delivered" && (inv.deliveredAt == null || !nonEmptyStr(inv.deliveryEventReference))) return { ok: false, code: "invoice_delivery_provenance_missing" };
  return { ok: true };
}
