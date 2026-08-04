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
import { CANONICAL_CLAIM_AMOUNT_SOURCES, CANONICAL_CLAIM_REQUIRED_FIELDS } from "@shared/schema/canonicalClaims";
import { reconcileLines, toCents, type MoneyLine } from "@shared/money";

const AMOUNT_SOURCES = new Set<string>(CANONICAL_CLAIM_AMOUNT_SOURCES);
const SUPPORTED_CURRENCIES = new Set(["USD"]);

// Which approved provenance sources may prove EACH field. A fee schedule proves
// codes/units only — NEVER payer, coverage, or provider. No cross-field inheritance.
const FIELD_SOURCE_ALLOW: Record<string, Set<string>> = {
  service_code: new Set(["approved_fee_schedule", "canonical_charge_config", "authorized_manual_entry", "imported_charge"]),
  units: new Set(["approved_fee_schedule", "canonical_charge_config", "authorized_manual_entry", "imported_charge"]),
  place_of_service: new Set(["facility_registry", "canonical_charge_config", "authorized_manual_entry"]),
  facility: new Set(["facility_registry", "authorized_manual_entry"]),
  rendering_provider: new Set(["credentialing_registry", "authorized_manual_entry"]),
  billing_provider: new Set(["credentialing_registry", "authorized_manual_entry"]),
  payer: new Set(["payer_contract", "coverage_import", "authorized_manual_entry"]),
  coverage_reference: new Set(["payer_contract", "coverage_import", "authorized_manual_entry"]),
  diagnosis: new Set(["clinical_documentation", "coverage_import", "authorized_manual_entry"]),
  authorization: new Set(["payer_contract", "authorized_manual_entry"]),
};

/** The EXACT approved claim-charge source carried on the Billing Document's
 *  source_data.claim_charge. Absent/partial → blockers (never invented). */
type ClaimChargeSource = {
  amountSource?: unknown; currency?: unknown; chargeAmount?: unknown;
  lineItems?: unknown; fields?: Record<string, unknown>; fieldProvenance?: Record<string, unknown>;
  requiresDiagnosis?: unknown; requiresAuthorization?: unknown;
};

/** The exact validated charge payload — persisted VERBATIM by the command service
 *  (never re-read/reinterpreted from arbitrary sourceData after this succeeds). */
export type ValidatedClaimCharge = {
  chargeAmount: string; amountSource: string; currency: string;
  lineItems: MoneyLine[]; fields: Record<string, string>;
  fieldProvenance: Record<string, { sourceType: string; sourceId: string | null }>;
};

/** Validate the approved claim charge: exact amount source, supported currency,
 *  reconciled line items, total = sum of lines, and every required coding/provider/
 *  payer field present from an approved source. Returns the exact validated payload
 *  ONLY when there are zero blockers. */
function evaluateClaimCharge(sd: { claimCharge?: ClaimChargeSource } | null): { charge: ValidatedClaimCharge | null; blockers: { code: string }[] } {
  const cc = sd?.claimCharge ?? null;
  const blockers: { code: string }[] = [];
  if (!cc || typeof cc !== "object") { return { charge: null, blockers: [{ code: "claim_amount_source_missing" }] }; }
  const amountSource = typeof cc.amountSource === "string" && AMOUNT_SOURCES.has(cc.amountSource) ? cc.amountSource : null;
  if (amountSource == null) blockers.push({ code: "claim_amount_source_invalid" });
  const currency = typeof cc.currency === "string" ? cc.currency.trim() : "";
  if (!currency || !SUPPORTED_CURRENCIES.has(currency)) blockers.push({ code: "claim_currency_unsupported" });
  // Line items must reconcile exactly, and the claim total must equal their sum.
  let chargeAmount: string | null = null; let lineItems: MoneyLine[] = [];
  const rawLines = Array.isArray(cc.lineItems) ? cc.lineItems : null;
  if (!rawLines || rawLines.length === 0) blockers.push({ code: "claim_line_items_missing" });
  else {
    const lines: MoneyLine[] = rawLines.map((l) => l as MoneyLine);
    const rec = reconcileLines(lines);
    if (!rec.ok) blockers.push({ code: `claim_${rec.code}` });
    else {
      let declared: number | null = null;
      try { declared = typeof cc.chargeAmount === "string" ? toCents(cc.chargeAmount) : null; } catch { declared = null; }
      if (declared == null) blockers.push({ code: "claim_charge_amount_invalid" });
      else if (declared !== rec.totalCents) blockers.push({ code: "claim_total_line_mismatch" });
      else if (declared < 0) blockers.push({ code: "claim_charge_amount_negative" });
      else { chargeAmount = cc.chargeAmount as string; lineItems = lines; }
    }
  }
  // Every required field must carry EXPLICIT approved field-specific provenance —
  // NO inheritance of the charge amount source. A fee schedule may prove a code/charge
  // only; it must NOT prove payer, coverage, or provider.
  const rawFields = (cc.fields && typeof cc.fields === "object") ? cc.fields : {};
  const fields: Record<string, string> = {}; const fieldProvenance: Record<string, { sourceType: string; sourceId: string | null }> = {};
  const required = [...CANONICAL_CLAIM_REQUIRED_FIELDS] as string[];
  if (cc.requiresDiagnosis === true) required.push("diagnosis");
  if (cc.requiresAuthorization === true) required.push("authorization");
  for (const f of required) {
    const cell = rawFields[f] as { value?: unknown; sourceType?: unknown; sourceId?: unknown } | undefined;
    const value = cell && typeof cell === "object" ? cell.value : undefined;
    if (value == null || (typeof value === "string" && value.trim().length === 0)) { blockers.push({ code: `claim_field_missing_${f}` }); continue; }
    const sourceType = cell && typeof cell.sourceType === "string" ? cell.sourceType : null;
    const allowed = FIELD_SOURCE_ALLOW[f];
    if (sourceType == null || !allowed || !allowed.has(sourceType)) { blockers.push({ code: `claim_field_provenance_invalid_${f}` }); continue; }
    fields[f] = String(value);
    fieldProvenance[f] = { sourceType, sourceId: cell && typeof cell.sourceId === "string" ? cell.sourceId : null };
  }
  if (blockers.length > 0 || chargeAmount == null || amountSource == null || !currency) return { charge: null, blockers };
  return { charge: { chargeAmount, amountSource, currency, lineItems, fields, fieldProvenance }, blockers };
}

export type CaseRef = {
  clinicId: number; ancillaryCaseId: number; serviceType: string;
  // §4 exact VERIFIED case identity. When present, the Billing Document identity
  // must agree exactly (never substitute the case identity for a wrong document).
  verifiedGlobalPlexusPatientId?: number | null;
  verifiedPatientClinicMembershipId?: number | null;
};

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
  // The complete validated charge payload — persisted verbatim by the command.
  currency: string | null;
  lineItems: MoneyLine[];
  fields: Record<string, string>;
  fieldProvenance: Record<string, { sourceType: string; sourceId: string | null }>;
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
  // Procedure-event agreement — normalize both sides to null; require exact equality
  // whenever EITHER is non-null (present/null, null/present, or different → reject).
  const rPE = (r.procedureEventId as number | null) ?? null, dPE = (d.procedureEventId as number | null) ?? null;
  if (rPE !== dPE) return notReady([{ code: "evidence_procedure_event_mismatch" }], [], "conflicting");
  // §4 Billing Document patient identity must equal the VERIFIED case identity — a
  // wrong-document identity is a conflict, NEVER silently replaced by the case's.
  if (c.verifiedGlobalPlexusPatientId != null || c.verifiedPatientClinicMembershipId != null) {
    if ((d.globalPlexusPatientId as number | null ?? null) !== (c.verifiedGlobalPlexusPatientId ?? null)
      || (d.patientClinicMembershipId as number | null ?? null) !== (c.verifiedPatientClinicMembershipId ?? null)) {
      return notReady([{ code: "billing_document_identity_mismatch" }], [], "conflicting");
    }
    // Readiness identity fields must agree where persisted.
    const rGpp = (r as { globalPlexusPatientId?: number | null }).globalPlexusPatientId ?? null;
    const rPcm = (r as { patientClinicMembershipId?: number | null }).patientClinicMembershipId ?? null;
    if ((rGpp != null && rGpp !== (c.verifiedGlobalPlexusPatientId ?? null)) || (rPcm != null && rPcm !== (c.verifiedPatientClinicMembershipId ?? null))) {
      return notReady([{ code: "billing_readiness_identity_mismatch" }], [], "conflicting");
    }
  }
  // Readiness + Billing Document must be in a state that permits claim progression.
  if (!READINESS_ALLOWS_CLAIM.has(r.canonicalStatus ?? "")) return notReady([{ code: "billing_readiness_not_claim_ready" }], [], "missing");
  if (!DOC_CURRENT_STATUSES.has(d.canonicalStatus ?? "")) return notReady([{ code: "billing_document_not_current" }], [], "missing");

  // Carry the exact claim-submission blockers from the readiness snapshot (never
  // invented). Missing coding/payer/provider/facility remains a blocker code here.
  // Project to {code} ONLY — never spread upstream blocker objects verbatim (they
  // may carry non-contract fields; keep the DTO promise of PHI-free code-only).
  for (const b of ((r.claimBlockers as { code?: unknown }[] | null) ?? [])) if (typeof b?.code === "string") blockers.push({ code: b.code });
  // Amount + every required claim field must come from an EXACT approved source
  // (fee schedule / canonical charge config / explicit import / authorized manual
  // entry) carried on source_data.claim_charge — never defaulted to zero, never
  // invented, and an arbitrary non-empty string never qualifies. Line items must
  // reconcile and the total must equal their exact sum.
  const { charge, blockers: chargeBlockers } = evaluateClaimCharge((d.sourceData as { claimCharge?: ClaimChargeSource } | null) ?? null);
  blockers.push(...chargeBlockers);

  const evidence: ClaimEvidence = {
    billingReadinessCheckId: r.id, billingDocumentId: d.id, evidenceFingerprint: rfp,
    orderNoteDocumentReferenceId: (d.orderNoteDocumentReferenceId as number | null) ?? null,
    reportDocumentReferenceId: (d.reportDocumentReferenceId as number | null) ?? null,
    procedureNoteDocumentReferenceId: (d.procedureNoteDocumentReferenceId as number | null) ?? null,
    procedureEventId: dPE,
    globalPlexusPatientId: (d.globalPlexusPatientId as number | null) ?? null,
    patientClinicMembershipId: (d.patientClinicMembershipId as number | null) ?? null,
    chargeAmount: charge?.chargeAmount ?? null, amountSource: charge?.amountSource ?? null,
    currency: charge?.currency ?? null, lineItems: charge?.lineItems ?? [],
    fields: charge?.fields ?? {}, fieldProvenance: charge?.fieldProvenance ?? {},
  };
  if (blockers.length > 0) return { claimReady: false, status: "not_ready", blockers, warnings: [], integrity: "resolved", evidence };
  return { claimReady: true, status: "ready", blockers: [], warnings: [], integrity: "resolved", evidence };
}
