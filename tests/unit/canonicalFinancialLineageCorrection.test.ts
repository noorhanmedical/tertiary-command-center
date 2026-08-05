// Phase 2J traceability correction — COMPLETE lineage + receipt-wide truth + negation
// eligibility + race-safe replay behavioral tests.
//
//   npx tsx tests/unit/canonicalFinancialLineageCorrection.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const lineageMod = () => import("../../server/services/canonicalFinancial/lineageValidators");
const allocMod = () => import("../../server/services/canonicalFinancial/allocationLineage");
const viewMod = () => import("../../server/services/canonicalFinancial/financialView");
const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const paymentCmd = () => import("../../server/services/canonicalFinancial/paymentCommands");
const claimCmd = () => import("../../server/services/canonicalFinancial/claimCommands");
const invoiceCmd = () => import("../../server/services/canonicalFinancial/invoiceCommands");
const cs = () => import("../../server/services/canonicalFinancial/commandSupport");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;

// ── coherent baseline claim + full context ──
const REFS = { procedureEventId: 400, orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13 };
const ID = { globalPlexusPatientId: 900, patientClinicMembershipId: 800 };
const LINES = [{ lineId: "l1", amount: "300.00", source: "approved_fee_schedule", unit: 1 }, { lineId: "l2", amount: "120.00", source: "approved_fee_schedule", unit: 1 }];
const PROV = Object.fromEntries(["service_code", "units", "place_of_service", "rendering_provider", "billing_provider", "facility", "payer", "coverage_reference"].map((f) => [f, { sourceType: "approved_source", sourceId: "s" }]));
const CASE = { clinicId: 1, serviceType: "BrainWave" };
const MEM = { clinicId: 1, membershipStatus: "active", globalPlexusPatientId: 900 };
const GP = { identityStatus: "active", mergedIntoPatientId: null };
const RD = { clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", supersededAt: null, evidenceFingerprint: "fp-1", ...REFS, ...ID };
const BD = { ...RD, billingReadinessCheckId: 500 };
function claim(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", ...ID, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...REFS, canonicalStatus: "ready", attemptNumber: 1, supersedesClaimId: null, currency: "USD", chargeAmount: "420.00", lineItems: LINES, fieldProvenance: PROV, submittedAt: null, submissionSource: null, submissionActorUserId: null, submissionReference: null, ...o }; }
function cctx(o: Record<string, unknown> = {}) { return { case: CASE, membership: MEM, globalPatient: GP, readiness: RD, billingDocument: BD, parentClaim: null, ...o }; }
const CLAIMCTX = { clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", currency: "USD", lineItems: LINES };
function inv(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", canonicalStatus: "issued", currency: "USD", totalAmount: "420.00", lineItems: LINES, invoiceType: "patient", recipientType: "patient_membership", recipientId: "M-1", supersedesInvoiceId: null, deliveredAt: null, deliveryEventReference: null, ...o }; }
function ictx(o: Record<string, unknown> = {}) { return { claim: CLAIMCTX, parentInvoice: null, ...o }; }

// ═══ direct claim-lineage conflict proofs ═══
async function testClaimLineageConflicts() {
  const { validateClaimLineage } = await lineageMod();
  const V = (c: unknown, x: unknown) => validateClaimLineage(c as never, x as never);
  assert.ok(V(claim(), cctx()).ok, "baseline coherent claim resolves");
  const bad = (c: Record<string, unknown>, x: Record<string, unknown>, code: string, msg: string) => { const r = V(claim(c), cctx(x)); assert.ok(!r.ok && r.code === code, `${msg} → ${code} (got ${JSON.stringify(r)})`); };
  // BD fingerprint / procedure / docref / identity mismatches
  bad({}, { billingDocument: { ...BD, evidenceFingerprint: "fp-2" } }, "claim_billing_document_fingerprint_mismatch", "BD fingerprint");
  bad({}, { billingDocument: { ...BD, procedureEventId: 999 } }, "claim_billing_document_procedure_mismatch", "BD procedureEventId");
  bad({}, { billingDocument: { ...BD, reportDocumentReferenceId: 999 } }, "claim_billing_document_reference_mismatch", "BD docref");
  bad({}, { billingDocument: { ...BD, globalPlexusPatientId: 901 } }, "claim_billing_document_identity_mismatch", "BD patient identity");
  bad({}, { billingDocument: { ...BD, billingReadinessCheckId: 501 } }, "claim_billing_document_readiness_mismatch", "BD readiness id");
  bad({}, { readiness: { ...RD, evidenceFingerprint: "fp-2" } }, "claim_readiness_fingerprint_mismatch", "readiness fingerprint");
  bad({}, { readiness: { ...RD, orderNoteDocumentReferenceId: 999 } }, "claim_readiness_reference_mismatch", "readiness docref");
  bad({}, { readiness: { ...RD, globalPlexusPatientId: 901 } }, "claim_readiness_identity_mismatch", "readiness identity");
  bad({ chargeAmount: "999.00" }, {}, "claim_total_mismatch", "line-reconcile ≠ chargeAmount");
  bad({ lineItems: [{ lineId: "l1", amount: "1.5x", source: "s" }] }, {}, "claim_line_items_invalid", "malformed lines");
  bad({ fieldProvenance: { service_code: { sourceType: "s" } } }, {}, "claim_field_provenance_missing", "missing field provenance");
  bad({ attemptNumber: 0 }, {}, "claim_attempt_invalid", "attemptNumber ≤ 0");
  bad({ currency: "EUR" }, {}, "claim_currency_unsupported", "unsupported currency");
  bad({ supersedesClaimId: 699, attemptNumber: 2 }, { parentClaim: null }, "claim_parent_not_found", "missing parent claim");
  bad({ supersedesClaimId: 699, attemptNumber: 2 }, { parentClaim: { clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", attemptNumber: 2 } }, "claim_parent_attempt_invalid", "parent attempt not < child");
  bad({ canonicalStatus: "submitted", submittedAt: OLD, submissionSource: "manual_attestation", submissionActorUserId: "u", submissionReference: null }, {}, "claim_submission_provenance_missing", "incomplete submitted provenance");
}
// ═══ direct invoice-lineage conflict proofs ═══
async function testInvoiceLineageConflicts() {
  const { validateInvoiceLineage } = await lineageMod();
  const V = (i: unknown, x: unknown) => validateInvoiceLineage(i as never, x as never);
  assert.ok(V(inv(), ictx()).ok, "baseline coherent invoice resolves");
  const bad = (i: Record<string, unknown>, x: Record<string, unknown>, code: string, msg: string) => { const r = V(inv(i), ictx(x)); assert.ok(!r.ok && r.code === code, `${msg} → ${code} (got ${JSON.stringify(r)})`); };
  bad({ currency: "EUR" }, { claim: { ...CLAIMCTX, currency: "USD" } }, "invoice_currency_mismatch", "currency mismatch");
  bad({ totalAmount: "999.00" }, {}, "invoice_total_mismatch", "line-reconcile ≠ total");
  bad({ lineItems: [{ lineId: "zzz", amount: "300.00", source: "s" }, { lineId: "l2", amount: "120.00", source: "s" }] }, {}, "invoice_lines_disagree_with_claim", "invoice lines ≠ claim lines");
  bad({ invoiceType: "bogus" }, {}, "invoice_type_invalid", "invalid type");
  bad({ recipientType: "bogus" }, {}, "invoice_recipient_type_invalid", "invalid recipient type");
  bad({ recipientId: "" }, {}, "invoice_recipient_id_missing", "empty recipientId");
  bad({ supersedesInvoiceId: 799 }, { parentInvoice: null }, "invoice_parent_not_found", "missing parent invoice");
  bad({ supersedesInvoiceId: 799 }, { parentInvoice: { clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 701 } }, "invoice_parent_mismatch", "parent invoice wrong claim");
  bad({ canonicalStatus: "delivered", deliveredAt: null, deliveryEventReference: null }, {}, "invoice_delivery_provenance_missing", "delivered without provenance");
}
// ═══ receipt-wide direct proofs ═══
async function testReceiptWide() {
  const { validateReceiptWide } = await allocMod();
  const rcpt = { clinicId: 1, currency: "USD", ancillaryCaseId: 5, serviceType: "BrainWave", amount: "500.00" };
  const a = (o: Record<string, unknown>) => ({ clinicId: 1, currency: "USD", ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", amount: "100.00", ...o });
  assert.ok(validateReceiptWide(rcpt as never, [a({ targetId: 800 }), a({ targetId: 801, amount: "200.00" })] as never).ok, "Σapply ≤ receipt across targets resolves");
  const over = validateReceiptWide(rcpt as never, [a({ amount: "300.00" }), a({ amount: "300.00" })] as never);
  assert.ok(!over.ok && over.code === "receipt_over_allocated", "Σapply > receipt across targets conflicts");
  const cur = validateReceiptWide(rcpt as never, [a({ currency: "EUR" })] as never);
  assert.ok(!cur.ok && cur.code === "receipt_allocation_currency_mismatch", "currency disagreement conflicts");
}

// ═══ read-model integration: incomplete lineage → status null ═══
function rmSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: Record<string, unknown[]>) {
  return new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => o.claims ?? [] }], [t.canonicalInvoices, { select: () => o.invoices ?? [] }],
    [t.canonicalPayments, { select: () => o.payments ?? [] }], [t.canonicalPaymentAllocations, { select: () => o.allocations ?? [] }],
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", ...ID }] }],
    [t.memberships, { select: () => [{ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }] }],
    [t.globalPatients, { select: () => [{ id: 900, identityStatus: "active", mergedIntoPatientId: null }] }],
    [t.billingReadinessChecks, { select: () => o.readiness ?? [{ id: 500, ...RD }] }],
    [t.billingDocumentRequests, { select: () => o.docs ?? [{ id: 600, ...BD }] }],
  ]);
}
async function testReadModelClaimBdMismatchNull() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  // BD carries a different procedure event than the claim → conflict → status null.
  const r = await runWithDb(rmSpec(t, { claims: [claim()], docs: [{ id: 600, ...BD, procedureEventId: 999 }] }), CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.rows[0].integrity, "conflicting", "BD procedure mismatch → conflicting");
  assert.equal(r.claims.rows[0].status, null, "conflicting claim → status null, never a stale raw status");
  assert.ok(r.claims.rows[0].warnings.includes("claim_lineage_conflict"));
}
async function testReadModelReceiptOverAllocated() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  // ONE 300 receipt applied 200 to invoice 800 AND 200 to invoice 801 → receipt-wide
  // over-allocation → both invoice balances conflict (never a resolved zero).
  const payment = { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "300.00", postedAt: OLD };
  const al = (id: number, targetId: number) => ({ id, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId, currency: "USD", amount: "200.00" });
  const r = await runWithDb(rmSpec(t, { invoices: [inv({ id: 800 }), inv({ id: 801 })], payments: [payment], allocations: [al(1, 800), al(2, 801)] }), CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  assert.ok(r.invoices.rows.every((x) => x.integrity === "conflicting" && x.balance.warnings.includes("receipt_over_allocated")), "receipt-wide over-allocation conflicts every funded invoice");
}
async function testReadModelReceiptWideTruncation() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  const payment = { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "999999.00", postedAt: OLD };
  // One target alloc (so the invoice references receipt 900), then a receipt-wide set of
  // >2000 allocations for receipt 900 → completeness unprovable → conflicting/unavailable.
  const targetAlloc = { id: 1, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "1.00" };
  const many = Array.from({ length: 2001 }, (_, i) => ({ id: 2 + i, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 900 + i, currency: "USD", amount: "1.00" }));
  // First allocation query (target-scoped) returns the single target alloc; the second
  // (receipt-wide) returns the truncated set.
  let call = 0;
  const spec = rmSpec(t, { invoices: [inv({ id: 800 })], payments: [payment] });
  spec.set(t.canonicalPaymentAllocations, { select: () => (call++ === 0 ? [targetAlloc] : [targetAlloc, ...many]) });
  const r = await runWithDb(spec, CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.invoices.rows[0].integrity, "conflicting", "receipt-wide truncation → conflicting");
  assert.ok(r.invoices.rows[0].balance.warnings.includes("receipt_wide_truncated"), "receipt-wide truncation surfaced");
}

// ═══ stage integration: payment target lineage gate ═══
async function testStagePaymentTargetLineageGate() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const svcCase = { id: 5, clinicId: 1, serviceType: "BrainWave", ...ID };
  // Invoice target is fully allocated (would be paid) BUT its evidence fingerprint drifted
  // from its claim → target lineage fails → payment stage must NOT read as paid.
  const claimT = { ...claim({ canonicalStatus: "submitted", submittedAt: OLD, submissionSource: "manual_attestation", submissionActorUserId: "u", submissionReference: "R" }) };
  const invT = inv({ id: 800, invoiceNumber: "INV-1", evidenceFingerprint: "fp-STALE" });
  const payment = { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", currency: "USD", amount: "420.00", postedAt: OLD };
  const alloc = { id: 1, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00" };
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }],
    [t.billingReadinessChecks, { select: () => [{ id: 500, ...RD }] }], [t.billingDocumentRequests, { select: () => [{ id: 600, ...BD }] }],
    [t.canonicalClaims, { select: () => [claimT] }], [t.canonicalInvoices, { select: () => [invT] }], [t.canonicalPayments, { select: () => [payment] }], [t.canonicalPaymentAllocations, { select: () => [alloc] }],
    [t.memberships, { select: () => [{ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }] }], [t.globalPatients, { select: () => [{ id: 900, identityStatus: "active", mergedIntoPatientId: null }] }],
  ]);
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
  assert.notEqual(v.payment.status, "paid", "lineage-stale target never derives paid");
  assert.equal(v.payment.integrity, "conflicting");
  assert.ok(v.payment.warnings.includes("payment_target_lineage_conflict"), "payment target lineage gate fired");
}

// ═══ negation target eligibility ═══
async function testNegationTargetEligibility() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const paymentRow = { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "420.00" };
  const parent = { id: 950, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00" };
  const invBase = { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, currency: "USD", totalAmount: "420.00", evidenceFingerprint: "fp-1", supersededAt: null };
  const mk = (status: string) => new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", ...ID }] }], [t.memberships, { select: () => [{ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" }] }], [t.globalPatients, { select: () => [{ id: 900, identityStatus: "active", mergedIntoPatientId: null }] }],
    [t.canonicalPayments, { select: () => [paymentRow] }],
    [t.canonicalInvoices, { select: () => [{ ...invBase, canonicalStatus: status }], onUpdate: (v: Record<string, unknown>) => [{ ...v, id: 800 }] }],
    [t.canonicalPaymentAllocations, { select: () => [parent], onInsert: (v: Record<string, unknown>) => [{ ...v, id: 970 }] }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: (v: Record<string, unknown>) => [{ ...v, id: 1 }] }],
  ]);
  for (const bad of ["draft", "approved", "issued", "voided", "rejected", "denied"]) {
    const r = await runWithDb(mk(bad), CHAIN, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, `no write on ineligible '${bad}'`); return res; });
    assert.equal(r.status, "target_not_payable", `ineligible target '${bad}' rejected`);
  }
  for (const okStatus of ["partially_paid", "paid"]) {
    const r = await runWithDb(mk(okStatus), CHAIN, async () => p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }));
    assert.equal(r.status, "refunded", `eligible target '${okStatus}' allows negation`);
  }
}

// ═══ race-safe replay in transition/correction unique-violation catch ═══
async function raceSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, entity: "claim" | "invoice", table: unknown, transitionsSeq: () => unknown[], throwOnAudit = true) {
  const dup = () => { throw Object.assign(new Error("dup"), { code: "23505" }); };
  const m = new Map<unknown, TableSpec>([
    [table, { select: () => entity === "claim"
      ? [{ id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "queued", attemptNumber: 1 }]
      : [{ id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "approved", claimId: 700, invoiceNumber: null }], onUpdate: (v: Record<string, unknown>) => [{ ...v, id: entity === "claim" ? 700 : 800 }] }],
    [t.canonicalFinancialTransitions, { select: transitionsSeq, onInsert: throwOnAudit ? dup : (v: Record<string, unknown>) => [{ ...v, id: 1 }] }],
  ]);
  return m;
}
async function testTransitionRaceReplay() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "transition_claim", clinicId: 1, claimId: 700, transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why" });
  const replayRow = { entityType: "claim", clinicId: 1, idempotencyKey: "k", entityId: 700, commandFingerprint: fp };
  // entry gate sees none; audit insert loses the race (23505); post-catch resolve finds
  // the SAME-intent winner → replay the exact prior success (never a generic conflict).
  let n = 0;
  const spec = await raceSpec(t, "claim", t.canonicalClaims, () => (n++ === 0 ? [] : [replayRow]));
  const r = await runWithDb(spec, CHAIN, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why", idempotencyKey: "k" }));
  assert.equal(r.status, "transitioned", "identical transition race replays exact success");
  // different-intent winner → idempotency_conflict, never a false replay.
  let n2 = 0;
  const spec2 = await raceSpec(t, "claim", t.canonicalClaims, () => (n2++ === 0 ? [] : [{ ...replayRow, commandFingerprint: "OTHER" }]));
  const r2 = await runWithDb(spec2, CHAIN, async () => c.transitionCanonicalClaim({ clinicId: 1, claimId: 700, actorUserId: "u", actorRole: "biller", transition: "submitted", sourceType: "manual_attestation", sourceReference: "R", reason: "why", idempotencyKey: "k" }));
  assert.equal(r2.status, "idempotency_conflict", "different-intent transition race → idempotency_conflict");
}
async function testInvoiceTransitionRaceReplay() {
  const t = await loadCanonicalTables(); const c = await invoiceCmd(); const { commandFingerprint } = await cs();
  const fp = commandFingerprint({ action: "transition_invoice", clinicId: 1, invoiceId: 800, transition: "issued", deliveryEventReference: undefined, sourceType: undefined, sourceReference: undefined, reason: undefined });
  const replayRow = { entityType: "invoice", clinicId: 1, idempotencyKey: "k", entityId: 800, commandFingerprint: fp };
  let n = 0;
  const spec = await raceSpec(t, "invoice", t.canonicalInvoices, () => (n++ === 0 ? [] : [replayRow]));
  const r = await runWithDb(spec, CHAIN, async () => c.transitionCanonicalInvoice({ clinicId: 1, invoiceId: 800, transition: "issued", actorUserId: "u", actorRole: "biller", idempotencyKey: "k" }));
  assert.equal(r.status, "transitioned", "identical invoice transition race replays exact success");
}

// ═══ N+1 guard: context loads are CONSTANT across 1 / 25 / 100 records ═══
async function testNoNPlusOne() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  for (const n of [1, 25, 100]) {
    const claims = Array.from({ length: n }, (_, i) => claim({ id: 700 + i, ancillaryCaseId: 5 }));
    const invoices = Array.from({ length: n }, (_, i) => inv({ id: 5000 + i }));
    let claimReads = 0, docReads = 0, allocReads = 0;
    const spec = rmSpec(t, { claims, invoices });
    // Count the secondary batched reads — must NOT scale with n.
    const wrap = (tbl: unknown, inc: () => void, rows: () => unknown[]) => spec.set(tbl, { select: () => { inc(); return rows(); } });
    await runWithDb(spec, CHAIN, async (calls: Call[]) => {
      await getCanonicalFinancialView({ clinicId: 1 });
      docReads = countOps(calls, "select", t.billingDocumentRequests);
      claimReads = countOps(calls, "select", t.billingReadinessChecks);
      allocReads = countOps(calls, "select", t.canonicalPaymentAllocations);
    });
    void wrap;
    assert.ok(docReads <= 2 && claimReads <= 2 && allocReads <= 2, `n=${n}: batched context reads constant (docs=${docReads} readiness=${claimReads} alloc=${allocReads})`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["claim lineage conflicts (BD/readiness/lines/provenance/attempt/parent/submitted)", testClaimLineageConflicts],
  ["invoice lineage conflicts (currency/lines/type/recipient/parent/delivery)", testInvoiceLineageConflicts],
  ["receipt-wide reconciliation direct", testReceiptWide],
  ["read model: incomplete claim lineage → status null", testReadModelClaimBdMismatchNull],
  ["read model: receipt-wide over-allocation conflicts funded invoices", testReadModelReceiptOverAllocated],
  ["read model: receipt-wide truncation → conflicting", testReadModelReceiptWideTruncation],
  ["stage: payment target lineage gate blocks paid", testStagePaymentTargetLineageGate],
  ["negation target eligibility (ineligible → zero writes)", testNegationTargetEligibility],
  ["race: transition replay + different-intent conflict", testTransitionRaceReplay],
  ["race: invoice transition replay", testInvoiceTransitionRaceReplay],
  ["N+1 guard: constant context reads at 1/25/100", testNoNPlusOne],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
