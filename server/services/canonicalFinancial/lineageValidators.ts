// Phase 2J — shared batched CLAIM/INVOICE lineage validators (read model + stage).
//
// Revalidates a persisted financial row against the CURRENT exact canonical context
// (identity + evidence + version), so a row that was valid at creation but is now
// stale (membership deactivated, global patient merged, evidence superseded, invoice
// disagrees with its claim) is surfaced as an integrity conflict rather than a false
// canonical result. Pure — the caller batch-loads context; no N+1.

const ACTIVE_IDENTITY = new Set(["active", "current"]);
const CLAIM_SUBMITTED_PLUS = new Set(["submitted", "accepted", "rejected", "denied", "partially_paid", "paid"]);

export type LineageVerdict = { ok: true } | { ok: false; code: string };

export type ClaimLineageRow = {
  clinicId: number; ancillaryCaseId: number | null; serviceType: string;
  globalPlexusPatientId: number | null; patientClinicMembershipId: number | null;
  canonicalStatus: string; submittedAt: unknown; submissionSource: string | null;
  evidenceFingerprint: string | null;
};
export type IdentityCtx = {
  case?: { clinicId: number; serviceType: string } | null;
  membership?: { clinicId: number; membershipStatus: string; globalPlexusPatientId: number | null } | null;
  globalPatient?: { identityStatus: string; mergedIntoPatientId: number | null } | null;
};

/** Revalidate one claim against the current case + verified identity + provenance. */
export function validateClaimLineage(claim: ClaimLineageRow, ctx: IdentityCtx): LineageVerdict {
  if (claim.ancillaryCaseId == null) return { ok: false, code: "claim_case_missing" };
  if (!ctx.case) return { ok: false, code: "claim_case_not_found" };
  if (ctx.case.clinicId !== claim.clinicId || ctx.case.serviceType !== claim.serviceType) return { ok: false, code: "claim_case_mismatch" };
  // Exact active membership pointing at the current non-merged global patient.
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
  // Submitted-or-later requires exact submission provenance.
  if (CLAIM_SUBMITTED_PLUS.has(claim.canonicalStatus) && (claim.submittedAt == null || claim.submissionSource == null)) return { ok: false, code: "claim_submission_provenance_missing" };
  if ((claim.evidenceFingerprint ?? "").trim().length === 0) return { ok: false, code: "claim_fingerprint_unresolved" };
  return { ok: true };
}

export type InvoiceLineageRow = {
  clinicId: number; ancillaryCaseId: number | null; serviceType: string; claimId: number | null;
  billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null;
  canonicalStatus: string; deliveryEventReference: string | null;
};
export type ClaimCtx = {
  clinicId: number; ancillaryCaseId: number | null; serviceType: string;
  billingDocumentId: number | null; billingReadinessCheckId: number | null; evidenceFingerprint: string | null;
} | null;

/** Revalidate one invoice against its exact claim (clinic/case/service + evidence
 *  version agreement) + delivery provenance. */
export function validateInvoiceLineage(inv: InvoiceLineageRow, claim: ClaimCtx): LineageVerdict {
  if (inv.claimId == null) return { ok: false, code: "invoice_claim_missing" };
  if (!claim) return { ok: false, code: "invoice_claim_not_found" };
  if (claim.clinicId !== inv.clinicId || (claim.ancillaryCaseId ?? null) !== (inv.ancillaryCaseId ?? null) || claim.serviceType !== inv.serviceType) return { ok: false, code: "invoice_claim_mismatch" };
  if ((claim.billingDocumentId ?? null) !== (inv.billingDocumentId ?? null)) return { ok: false, code: "invoice_billing_document_mismatch" };
  if ((claim.billingReadinessCheckId ?? null) !== (inv.billingReadinessCheckId ?? null)) return { ok: false, code: "invoice_readiness_mismatch" };
  if ((claim.evidenceFingerprint ?? null) !== (inv.evidenceFingerprint ?? null)) return { ok: false, code: "invoice_fingerprint_mismatch" };
  if (inv.canonicalStatus === "delivered" && (inv.deliveryEventReference ?? "").trim().length === 0) return { ok: false, code: "invoice_delivery_provenance_missing" };
  return { ok: true };
}
