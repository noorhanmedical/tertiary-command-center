// Phase 2J — canonical claim-readiness evaluator (pure).
//
// Billing-ready ≠ claim-ready. A claim may become ready only when exact
// clinic/case/service ownership is proven; exactly ONE current non-superseded
// billing-readiness snapshot AND one current non-superseded Billing Document
// exist; the Billing Document is bound to that readiness by billingReadinessCheckId
// + a NON-EMPTY EQUAL evidenceFingerprint + SYMMETRICALLY-agreeing exact
// order-note/report/procedure-note reference ids (+ procedure event id where
// persisted); readiness permits claim progression; and claim_submission_blockers is
// empty. Missing coding/payer/provider/facility/amount is a PHI-free blocker — never
// invented. More than one current record → integrity conflict (never first/newest).

import type { CanonicalBillingReadinessCheck } from "@shared/schema/billingReadiness";
import type { CanonicalBillingDocumentRequest } from "@shared/schema/billingDocuments";

export type CaseRef = { clinicId: number; ancillaryCaseId: number; serviceType: string };

export type ClaimEvidence = {
  billingReadinessCheckId: number;
  billingDocumentId: number;
  evidenceFingerprint: string;
  orderNoteDocumentReferenceId: number | null;
  reportDocumentReferenceId: number | null;
  procedureNoteDocumentReferenceId: number | null;
  procedureEventId: number | null;
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
  chargeAmount: string | null;
  amountSource: string | null;
};

export type ClaimReadinessResult = {
  claimReady: boolean;
  status: "not_ready" | "ready";
  blockers: { code: string }[];       // claim_submission_blockers (PHI-free)
  warnings: string[];
  integrity: "resolved" | "missing" | "conflicting";
  evidence: ClaimEvidence | null;     // present only when a single exact version is bound
};

const READINESS_ALLOWS_CLAIM = new Set(["ready_to_generate", "billing_document_generated"]);
const DOC_CURRENT_STATUSES = new Set(["generated", "approved"]);

function pickSingleCurrent<R extends { supersededAt: unknown; clinicId: number | null; ancillaryCaseId: number | null; serviceType: string }>(rows: R[], c: CaseRef): { kind: "missing" } | { kind: "one"; row: R } | { kind: "conflict" } {
  const current = rows.filter((r) => r.clinicId === c.clinicId && r.ancillaryCaseId === c.ancillaryCaseId && r.serviceType === c.serviceType && r.supersededAt == null);
  if (current.length === 0) return { kind: "missing" };
  if (current.length > 1) return { kind: "conflict" };
  return { kind: "one", row: current[0] };
}
const nonEmpty = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

/** Evaluate claim readiness from the case's current canonical readiness + Billing
 *  Document rows (exact clinic/case/service already implied by the caller's scope,
 *  re-checked here in memory). */
export function evaluateClaimReadiness(
  c: CaseRef,
  readinessRows: CanonicalBillingReadinessCheck[],
  billingDocRows: CanonicalBillingDocumentRequest[],
): ClaimReadinessResult {
  const notReady = (blockers: { code: string }[], warnings: string[], integrity: ClaimReadinessResult["integrity"]): ClaimReadinessResult =>
    ({ claimReady: false, status: "not_ready", blockers, warnings, integrity, evidence: null });

  const rPick = pickSingleCurrent(readinessRows, c);
  if (rPick.kind === "conflict") return notReady([{ code: "duplicate_current_readiness" }], ["duplicate_current_evidence"], "conflicting");
  const dPick = pickSingleCurrent(billingDocRows, c);
  if (dPick.kind === "conflict") return notReady([{ code: "duplicate_current_billing_document" }], ["duplicate_current_evidence"], "conflicting");
  if (rPick.kind === "missing") return notReady([{ code: "billing_readiness_missing" }], [], "missing");
  if (dPick.kind === "missing") return notReady([{ code: "billing_document_missing" }], [], "missing");

  const r = rPick.row, d = dPick.row;
  const blockers: { code: string }[] = [];
  // Exact version binding (readiness ↔ Billing Document).
  if (d.billingReadinessCheckId !== r.id) return notReady([{ code: "billing_document_wrong_readiness" }], [], "conflicting");
  const rfp = nonEmpty(r.evidenceFingerprint), dfp = nonEmpty(d.evidenceFingerprint);
  if (rfp == null || dfp == null) return notReady([{ code: "evidence_fingerprint_unresolved" }], [], "conflicting");
  if (rfp !== dfp) return notReady([{ code: "evidence_fingerprint_stale" }], [], "conflicting");
  // Symmetric reference-id agreement.
  for (const k of ["orderNoteDocumentReferenceId", "reportDocumentReferenceId", "procedureNoteDocumentReferenceId"] as const) {
    const rr = (r[k] as number | null) ?? null, dd = (d[k] as number | null) ?? null;
    if (rr !== dd) return notReady([{ code: "evidence_reference_mismatch" }], [], "conflicting");
  }
  // Readiness + Billing Document must be in a state that permits claim progression.
  if (!READINESS_ALLOWS_CLAIM.has(r.canonicalStatus ?? "")) return notReady([{ code: "billing_readiness_not_claim_ready" }], [], "missing");
  if (!DOC_CURRENT_STATUSES.has(d.canonicalStatus ?? "")) return notReady([{ code: "billing_document_not_current" }], [], "missing");

  // Carry the exact claim-submission blockers from the readiness snapshot (never
  // invented). Missing coding/payer/provider/facility remains a blocker code here.
  // Project to {code} ONLY — never spread upstream blocker objects verbatim (they
  // may carry non-contract fields; keep the DTO promise of PHI-free code-only).
  for (const b of ((r.claimBlockers as { code?: unknown }[] | null) ?? [])) if (typeof b?.code === "string") blockers.push({ code: b.code });
  // Amount must come from an EXACT approved source (fee schedule / canonical charge
  // config / explicitly imported / authorized manual entry) — never defaulted to
  // zero and never invented. The Billing Document carries no charge; an approved
  // amount, when present, is an exact provenance-tagged value on source_data.
  const sd = (d.sourceData as { chargeAmount?: string; amountSource?: string } | null) ?? null;
  const chargeAmount = nonEmpty(sd?.chargeAmount);
  const amountSource = nonEmpty(sd?.amountSource);
  if (chargeAmount == null || amountSource == null) blockers.push({ code: "claim_amount_source_missing" });

  const evidence: ClaimEvidence = {
    billingReadinessCheckId: r.id, billingDocumentId: d.id, evidenceFingerprint: rfp,
    orderNoteDocumentReferenceId: (d.orderNoteDocumentReferenceId as number | null) ?? null,
    reportDocumentReferenceId: (d.reportDocumentReferenceId as number | null) ?? null,
    procedureNoteDocumentReferenceId: (d.procedureNoteDocumentReferenceId as number | null) ?? null,
    procedureEventId: (d.procedureEventId as number | null) ?? null,
    globalPlexusPatientId: (d.globalPlexusPatientId as number | null) ?? null,
    patientClinicMembershipId: (d.patientClinicMembershipId as number | null) ?? null,
    chargeAmount, amountSource,
  };
  if (blockers.length > 0) return { claimReady: false, status: "not_ready", blockers, warnings: [], integrity: "resolved", evidence };
  return { claimReady: true, status: "ready", blockers: [], warnings: [], integrity: "resolved", evidence };
}
