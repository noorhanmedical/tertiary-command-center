// Phase 2J — canonical claim/invoice/payment lifecycle: money invariants, balance
// reconciliation, claim readiness, state machines, read model, route auth/flags/503.
//
//   npx tsx tests/unit/canonicalFinancialLifecycle.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const money = () => import("../../shared/money");
const balance = () => import("../../server/services/canonicalFinancial/balance");
const readiness = () => import("../../server/services/canonicalFinancial/claimReadiness");
const sm = () => import("../../server/services/canonicalFinancial/stateMachines");
const view = () => import("../../server/services/canonicalFinancial/financialView");
const routes = () => import("../../server/routes/canonicalFinancial");
const dto = () => import("../../shared/canonicalFinancialView");

const OLD = new Date("2027-06-10T09:00:00Z");
// Full canonical chain enabling claims/invoices/payments runtime.
const ALL = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;

// ── builders ──
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800, ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, claimBlockers: [], warnings: [], ...o }; }
// An exact approved claim charge (amount source vocabulary + reconciled lines +
// required fields). Tests override pieces to exercise the readiness contract.
function claimFields() {
  return {
    service_code: { value: "SVC", sourceType: "approved_fee_schedule" }, units: { value: "1", sourceType: "approved_fee_schedule" },
    place_of_service: { value: "11", sourceType: "facility_registry" }, facility: { value: "FAC", sourceType: "facility_registry" },
    rendering_provider: { value: "RP", sourceType: "credentialing_registry" }, billing_provider: { value: "BP", sourceType: "credentialing_registry" },
    payer: { value: "PAYER", sourceType: "payer_contract" }, coverage_reference: { value: "COV", sourceType: "payer_contract" },
  };
}
function claimCharge(o: Record<string, unknown> = {}) {
  return {
    amountSource: "approved_fee_schedule", currency: "USD", chargeAmount: "420.00",
    lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }],
    fields: claimFields(),
    ...o,
  };
}
function billingDocRow(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, globalPlexusPatientId: 900, patientClinicMembershipId: 800, sourceData: { claimCharge: claimCharge() }, ...o }; }
const LINES = [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }];
const PROV = Object.fromEntries(["service_code", "units", "place_of_service", "rendering_provider", "billing_provider", "facility", "payer", "coverage_reference"].map((f) => [f, { sourceType: "approved_source", sourceId: "s" }]));
function claimRow(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", attemptNumber: 1, supersedesClaimId: null, supersededAt: null, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", procedureEventId: 400, orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "420.00", lineItems: LINES, fieldProvenance: PROV, claimSubmissionBlockers: [], warnings: [], submittedAt: null, submissionSource: null, submissionActorUserId: "u", submissionReference: "REF-1", updatedAt: OLD, ...o }; }
function invoiceRow(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", canonicalStatus: "issued", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M-1", invoiceNumber: "INV-1", currency: "USD", totalAmount: "420.00", lineItems: LINES, supersedesInvoiceId: null, supersededAt: null, issuedAt: OLD, deliveredAt: null, deliveryEventReference: null, warnings: [], ...o }; }
function paymentRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, invoiceId: 800, eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "100.00", externalTransactionId: null, reversesPaymentId: null, postedAt: OLD, ...o }; }
function allocRow(o: Record<string, unknown> = {}) { return { id: 950, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "100.00", isOverpayment: 0, ...o }; }

function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { claims?: unknown[]; invoices?: unknown[]; payments?: unknown[]; allocations?: unknown[]; cases?: unknown[]; memberships?: unknown[]; globalPatients?: unknown[]; readiness?: unknown[]; docs?: unknown[]; claimsMig?: boolean; invoicesErr?: boolean } = {}) {
  const mig = () => { throw Object.assign(new Error("relation missing"), { code: "42P01" }); };
  return new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => { if (o.claimsMig) return mig(); return o.claims ?? []; } }],
    [t.canonicalInvoices, { select: () => { if (o.invoicesErr) throw new Error("inv down"); return o.invoices ?? []; } }],
    [t.canonicalPayments, { select: () => o.payments ?? [] }],
    [t.canonicalPaymentAllocations, { select: () => o.allocations ?? [] }],
    [t.ancillaryCases, { select: () => o.cases ?? [acase(), acase({ id: 6, ancillaryCaseId: 6 }), acase({ id: 9 })] }],
    [t.memberships, { select: () => o.memberships ?? [pcm()] }],
    [t.globalPatients, { select: () => o.globalPatients ?? [gpp()] }],
    [t.billingReadinessChecks, { select: () => o.readiness ?? [readinessRow()] }],
    [t.billingDocumentRequests, { select: () => o.docs ?? [billingDocRow()] }],
  ]);
}
function pcm(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active", ...o }; }
function gpp(o: Record<string, unknown> = {}) { return { id: 900, identityStatus: "active", mergedIntoPatientId: null, ...o }; }

// ═══ Money invariants (§9, §13) ═══
async function testMoney() {
  const m = await money();
  assert.equal(m.toCents("420.00"), 42000); assert.equal(m.toCents("0.05"), 5); assert.equal(m.toCents("-1.50"), -150);
  assert.equal(m.centsToString(42000), "420.00"); assert.equal(m.centsToString(5), "0.05"); assert.equal(m.centsToString(-150), "-1.50");
  // round-trip large sum, no float drift
  const cents = Array.from({ length: 1000 }, () => m.toCents("0.10"));
  assert.equal(m.centsToString(m.sumCents(cents)), "100.00");
  assert.throws(() => m.toCents("1.005"), /fixed_precision/, "fractional cent rejected");
  assert.throws(() => m.toCents("NaN"), /fixed_precision/);
  assert.throws(() => m.toCents(Infinity), /fixed_precision/);
  // line reconciliation
  const ok = m.reconcileLines([{ lineId: "a", amount: "100.00", source: "fee" }, { lineId: "b", amount: "20.00", source: "fee" }]);
  assert.ok(ok.ok && ok.totalCents === 12000, "(50) totals reconcile to line items");
  assert.ok(!m.reconcileLines([{ lineId: "a", amount: "1", source: "x" }, { lineId: "a", amount: "1", source: "x" }]).ok, "duplicate line identity rejected");
  assert.ok(!m.reconcileLines([{ lineId: "a", amount: "-5.00", source: "x" }]).ok, "negative rejected without adjustment");
  assert.ok(m.reconcileLines([{ lineId: "a", amount: "-5.00", source: "x" }], { allowNegative: true }).ok, "negative allowed as adjustment");
}

// ═══ Balance reconciliation (§13, §12) ═══
async function testBalance() {
  const b = await balance();
  const base = (ledger: unknown[]) => b.deriveBalance({ currency: "USD", originalAmountCents: 42000, ledger: ledger as never });
  const partial = base([paymentRow({ amount: "100.00" })]);
  assert.equal(partial.paidAmount, "100.00"); assert.equal(partial.outstandingBalance, "320.00", "(80) partial payment balance correct");
  const paid = base([paymentRow({ amount: "420.00" })]);
  assert.equal(paid.outstandingBalance, "0.00");
  const refund = base([paymentRow({ id: 1, amount: "420.00" }), paymentRow({ id: 2, eventType: "refund", amount: "20.00" })]);
  assert.equal(refund.refundedAmount, "20.00"); assert.equal(refund.outstandingBalance, "20.00", "(81) refund increases outstanding");
  const reversal = base([paymentRow({ id: 1, amount: "100.00" }), paymentRow({ id: 2, eventType: "reversal", amount: "100.00" })]);
  assert.equal(reversal.reversedAmount, "100.00"); assert.equal(reversal.outstandingBalance, "420.00", "(69/82) reversed not collected");
  const failed = base([paymentRow({ status: "failed", amount: "420.00" })]);
  assert.equal(failed.paidAmount, "0.00", "(68) failed not counted");
  const reversedStatus = base([paymentRow({ status: "reversed", amount: "420.00" })]);
  assert.equal(reversedStatus.paidAmount, "0.00"); assert.equal(reversedStatus.outstandingBalance, "420.00", "reversed-status payment never counts as collected (no double-negate)");
  const over = base([paymentRow({ amount: "500.00" })]);
  assert.equal(over.overpayment, "80.00", "(66/84) overpayment explicit"); assert.equal(over.outstandingBalance, "0.00");
  const unapplied = b.deriveBalance({ currency: "USD", originalAmountCents: 42000, ledger: [paymentRow({ claimId: null, invoiceId: null, amount: "50.00" })] as never });
  assert.equal(unapplied.unappliedAmount, "50.00", "(67) unapplied explicit");
  const mismatch = b.deriveBalance({ currency: "USD", originalAmountCents: 42000, ledger: [paymentRow({ currency: "EUR" })] as never });
  assert.equal(mismatch.integrity, "conflicting"); assert.equal(mismatch.outstandingBalance, "0.00", "(83) conflict not shown as paid/zero-collected");
}
async function testAllocation() {
  const b = await balance();
  assert.ok(b.validateAllocation({ paymentClinicId: 1, targetClinicId: 1, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 5, paymentCurrency: "USD", targetCurrency: "USD", amountCents: 100, paymentRemainingCents: 200, targetOutstandingCents: 200 }).ok, "valid allocation");
  assert.ok(!b.validateAllocation({ paymentClinicId: 1, targetClinicId: 2, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 5, paymentCurrency: "USD", targetCurrency: "USD", amountCents: 100, paymentRemainingCents: 200, targetOutstandingCents: 200 }).ok, "(72) cross-clinic allocation rejected");
  assert.ok(!b.validateAllocation({ paymentClinicId: 1, targetClinicId: 1, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 6, paymentCurrency: "USD", targetCurrency: "USD", amountCents: 100, paymentRemainingCents: 200, targetOutstandingCents: 200 }).ok, "(73) wrong-case allocation rejected");
  assert.ok(!b.validateAllocation({ paymentClinicId: 1, targetClinicId: 1, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 5, paymentCurrency: "USD", targetCurrency: "EUR", amountCents: 100, paymentRemainingCents: 200, targetOutstandingCents: 200 }).ok, "(74) currency mismatch rejected");
  assert.ok(!b.validateAllocation({ paymentClinicId: 1, targetClinicId: 1, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 5, paymentCurrency: "USD", targetCurrency: "USD", amountCents: 300, paymentRemainingCents: 200, targetOutstandingCents: 500 }).ok, "over-payment-amount rejected");
  assert.ok(!b.validateAllocation({ paymentClinicId: 1, targetClinicId: 1, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 5, paymentCurrency: "USD", targetCurrency: "USD", amountCents: 300, paymentRemainingCents: 500, targetOutstandingCents: 200 }).ok, "(75) over-allocation rejected");
  assert.ok(b.validateAllocation({ paymentClinicId: 1, targetClinicId: 1, paymentAncillaryCaseId: 5, targetAncillaryCaseId: 5, paymentCurrency: "USD", targetCurrency: "USD", amountCents: 300, paymentRemainingCents: 500, targetOutstandingCents: 200, allowOverpayment: true }).ok, "explicit overpayment allowed");
}

// ═══ Claim readiness (§7) ═══
async function testClaimReadiness() {
  const r = await readiness();
  const c = { clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave" };
  const ready = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow()] as never);
  assert.ok(ready.claimReady && ready.status === "ready", "(22) exact readiness+doc version + amount source qualifies");
  assert.ok(ready.evidence && ready.evidence.evidenceFingerprint === "fp-1");
  const blocked = r.evaluateClaimReadiness(c, [readinessRow({ claimBlockers: [{ code: "missing_payer" }] })] as never, [billingDocRow()] as never);
  assert.ok(!blocked.claimReady && blocked.blockers.some((x) => x.code === "missing_payer"), "(23/25/32) claim blocker prevents readiness & stays visible");
  const noAmount = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: {} })] as never);
  assert.ok(!noAmount.claimReady && noAmount.blockers.some((x) => x.code === "claim_amount_source_missing"), "(34) no invented amount");
  // Exact claim-charge contract (§3): arbitrary/invalid sources never qualify.
  const arbSource = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: { claimCharge: claimCharge({ amountSource: "whatever" }) } })] as never);
  assert.ok(!arbSource.claimReady && arbSource.blockers.some((x) => x.code === "claim_amount_source_invalid"), "arbitrary amount source rejected");
  const badTotal = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: { claimCharge: claimCharge({ chargeAmount: "500.00" }) } })] as never);
  assert.ok(!badTotal.claimReady && badTotal.blockers.some((x) => x.code === "claim_total_line_mismatch"), "total != sum of line items rejected");
  const dupLine = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: { claimCharge: claimCharge({ lineItems: [{ lineId: "l1", amount: "210.00", source: "s" }, { lineId: "l1", amount: "210.00", source: "s" }] }) } })] as never);
  assert.ok(!dupLine.claimReady && dupLine.blockers.some((x) => x.code === "claim_line_duplicate_identity"), "duplicate line identity rejected");
  const negAmt = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: { claimCharge: claimCharge({ chargeAmount: "1.5x", lineItems: [{ lineId: "l1", amount: "1.5x", source: "s" }] }) } })] as never);
  assert.ok(!negAmt.claimReady && negAmt.blockers.some((x) => x.code === "claim_line_amount_invalid"), "invalid decimal amount rejected");
  const negUnits = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: { claimCharge: claimCharge({ lineItems: [{ lineId: "l1", amount: "420.00", source: "s", unit: -1 }] }) } })] as never);
  assert.ok(!negUnits.claimReady && negUnits.blockers.some((x) => x.code === "claim_line_negative_units"), "negative units rejected");
  const missField = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ sourceData: { claimCharge: claimCharge({ fields: { service_code: "SVC" } }) } })] as never);
  assert.ok(!missField.claimReady && missField.blockers.some((x) => x.code === "claim_field_missing_payer"), "missing required field blocked, not invented");
  const staleFp = r.evaluateClaimReadiness(c, [readinessRow({ evidenceFingerprint: "fp-2" })] as never, [billingDocRow({ evidenceFingerprint: "fp-1" })] as never);
  assert.ok(!staleFp.claimReady && staleFp.integrity === "conflicting" && staleFp.blockers.some((x) => x.code === "evidence_fingerprint_stale"), "(29) fingerprint mismatch rejected");
  const nullFp = r.evaluateClaimReadiness(c, [readinessRow({ evidenceFingerprint: null })] as never, [billingDocRow({ evidenceFingerprint: null })] as never);
  assert.ok(nullFp.blockers.some((x) => x.code === "evidence_fingerprint_unresolved"), "(28) null fingerprint rejected");
  const wrongReadinessId = r.evaluateClaimReadiness(c, [readinessRow({ id: 500 })] as never, [billingDocRow({ billingReadinessCheckId: 777 })] as never);
  assert.ok(wrongReadinessId.blockers.some((x) => x.code === "billing_document_wrong_readiness"), "(30) readiness-ID mismatch rejected");
  const refMismatch = r.evaluateClaimReadiness(c, [readinessRow({ orderNoteDocumentReferenceId: 11 })] as never, [billingDocRow({ orderNoteDocumentReferenceId: 99 })] as never);
  assert.ok(refMismatch.blockers.some((x) => x.code === "evidence_reference_mismatch"), "(31) document-reference mismatch rejected");
  const dupReadiness = r.evaluateClaimReadiness(c, [readinessRow({ id: 500 }), readinessRow({ id: 501 })] as never, [billingDocRow()] as never);
  assert.ok(dupReadiness.integrity === "conflicting" && dupReadiness.blockers.some((x) => x.code === "duplicate_current_readiness"), "(35) multiple current readiness → conflict");
  const dupDoc = r.evaluateClaimReadiness(c, [readinessRow()] as never, [billingDocRow({ id: 600 }), billingDocRow({ id: 601 })] as never);
  assert.ok(dupDoc.integrity === "conflicting", "(36) multiple current Billing Documents → conflict");
  const wrongCase = r.evaluateClaimReadiness({ clinicId: 1, ancillaryCaseId: 6, serviceType: "BrainWave" }, [readinessRow({ ancillaryCaseId: 5 })] as never, [billingDocRow({ ancillaryCaseId: 5 })] as never);
  assert.equal(wrongCase.status, "not_ready", "(12) wrong case → not the case's readiness");
  const wrongClinic = r.evaluateClaimReadiness(c, [readinessRow({ clinicId: 2 })] as never, [billingDocRow()] as never);
  assert.ok(wrongClinic.blockers.some((x) => x.code === "billing_readiness_missing"), "(11) wrong-clinic readiness never used");
}

// ═══ State machines (§8, §10) ═══
async function testStateMachines() {
  const s = await sm();
  assert.ok(s.canTransitionClaim("draft", "queued") && s.canTransitionClaim("queued", "submitted"), "(40) valid transitions");
  assert.ok(!s.canTransitionClaim("submitted", "draft"), "(41/42) submitted immutable — cannot go back to draft");
  assert.ok(!s.canTransitionClaim("paid", "draft"), "terminal paid cannot revert");
  assert.ok(s.CLAIM_IMMUTABLE_SUBMITTED.has("submitted"));
  assert.ok(s.claimSubmissionSourceValid("clearinghouse_response") && s.claimSubmissionSourceValid("manual_attestation"), "(48) submitted requires exact source");
  assert.ok(!s.claimSubmissionSourceValid("button_click") && !s.claimSubmissionSourceValid(null), "(49) no fake clearinghouse ack");
  assert.ok(s.evidenceChangeSupersedes("draft", "fp-1", "fp-2"), "(46) evidence change supersedes unsubmitted draft");
  assert.ok(!s.evidenceChangeSupersedes("submitted", "fp-1", "fp-2"), "(47) evidence change never rewrites submitted history");
  assert.ok(s.canTransitionInvoice("draft", "approved") && s.canTransitionInvoice("approved", "issued"), "invoice transitions");
  assert.ok(!s.canTransitionInvoice("issued", "draft"), "(57) issued invoice immutable");
  assert.ok(!s.invoiceDeliveredRequiresEvent("delivered", null), "(59) delivered requires exact event");
  assert.ok(s.invoiceDeliveredRequiresEvent("delivered", "evt-1"));
}

// ═══ Read model + route (§16, §22 API) ═══
async function testViewFlagsAndReads() {
  const t = await loadCanonicalTables(); const v = await view();
  // flag OFF → upstream_flag_off + zero reads
  const off = await runWithDb(spec(t, {}), { ...ALL, canonicalClaims: false, canonicalInvoices: false, canonicalPayments: false }, async (calls: Call[]) => {
    const r = await v.getCanonicalFinancialView({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.canonicalClaims), 0, "(5) zero claim reads when flag off");
    return r;
  });
  assert.equal(off.claims.availability, "upstream_flag_off"); assert.equal(off.invoices.availability, "upstream_flag_off"); assert.equal(off.payments.availability, "upstream_flag_off");
}
async function testViewRows() {
  const t = await loadCanonicalTables(); const v = await view();
  const r = await runWithDb(spec(t, { claims: [claimRow()], invoices: [invoiceRow()], payments: [paymentRow({ amount: "100.00" })], allocations: [allocRow({ amount: "100.00" })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.rows.length, 1); assert.equal(r.claims.rows[0].status, "ready");
  assert.equal(r.invoices.rows.length, 1);
  assert.equal(r.invoices.rows[0].balance.paidAmount, "100.00"); assert.equal(r.invoices.rows[0].balance.outstandingBalance, "320.00", "(79) invoice balance reconciles from allocations");
  assert.equal(r.payments.rows.length, 1); assert.equal(r.payments.rows[0].amount, "100.00");
  // no revenue-share / profit fields, no card/bank data
  const keys = JSON.stringify(r).toLowerCase();
  for (const bad of ["revenueshare", "plexussplit", "profit", "cardnumber", "routingnumber", "cvv"]) assert.ok(!keys.includes(bad), `no ${bad} field`);
  // A corrupt persisted total is a CONFLICT, never a silent resolved 0.00 balance.
  const bad = await runWithDb(spec(t, { invoices: [invoiceRow({ totalAmount: "not-a-number" })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(bad.invoices.rows[0].integrity, "conflicting", "invalid invoice total → conflict");
  assert.equal(bad.invoices.rows[0].balance.integrity, "conflicting", "invalid total → balance conflict, not resolved zero");
  assert.ok(bad.invoices.rows[0].balance.warnings.includes("invoice_amount_invalid"));
}
async function testViewConflictAndBatch() {
  const t = await loadCanonicalTables(); const v = await view();
  // duplicate current claim per case → conflict
  const dup = await runWithDb(spec(t, { claims: [claimRow({ id: 700 }), claimRow({ id: 701 })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.ok(dup.claims.rows.every((x) => x.integrity === "conflicting" && x.warnings.includes("duplicate_current_evidence")), "duplicate current claim → conflict, not first/newest");
  // batched allocation reads for invoice balances — CONSTANT count regardless of the
  // invoice count (no per-invoice N+1): one target-scoped read for the page balances +
  // one receipt-WIDE read for the referenced receipts' complete allocation sets.
  await runWithDb(spec(t, { invoices: [invoiceRow({ id: 800 }), invoiceRow({ id: 801 })], allocations: [allocRow({ targetId: 800 }), allocRow({ id: 951, targetId: 801 })] }), ALL, async (calls: Call[]) => {
    await v.getCanonicalFinancialView({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.canonicalPaymentAllocations), 2, "(90) two BATCHED allocation reads (target-wide + receipt-wide), not per-invoice N+1");
  });
}
async function testViewCrossClinic() {
  const t = await loadCanonicalTables(); const v = await view();
  const r = await runWithDb(spec(t, { claims: [claimRow({ id: 700, clinicId: 1 }), claimRow({ id: 701, clinicId: 2 })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.rows.length, 1, "(20) no cross-clinic claim leakage"); assert.equal(r.claims.rows[0].claimId, 700);
}
async function testViewPagination() {
  const t = await loadCanonicalTables(); const v = await view();
  const claims = Array.from({ length: 3 }, (_, i) => claimRow({ id: 700 + i, ancillaryCaseId: 5 + i }));
  const r = await runWithDb(spec(t, { claims }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1, limit: 2 }));
  assert.equal(r.claims.rows.length, 2, "(86) bounded claim pagination"); assert.ok(r.claims.pageInfo.nextCursor, "(89) deterministic cursor");
}
async function testViewHistoryNotDuplicate() {
  const t = await loadCanonicalTables(); const v = await view();
  // A submitted historical attempt + a correction draft for the SAME case is VALID
  // and must NOT read as a duplicate-current conflict.
  const valid = await runWithDb(spec(t, { claims: [claimRow({ id: 700, canonicalStatus: "submitted", attemptNumber: 1, submittedAt: OLD, submissionSource: "manual_attestation" }), claimRow({ id: 701, canonicalStatus: "draft", attemptNumber: 2 })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.ok(valid.claims.rows.every((x) => x.integrity === "resolved"), "(1/30) submitted history + correction draft is not a conflict");
  // TWO active working attempts for one case IS a conflict.
  const dup = await runWithDb(spec(t, { claims: [claimRow({ id: 700, canonicalStatus: "draft", attemptNumber: 1 }), claimRow({ id: 701, canonicalStatus: "ready", attemptNumber: 2 })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.ok(dup.claims.rows.every((x) => x.integrity === "conflicting"), "(3/31) two active working claims conflict");
}
async function testViewClaimLineageConflict() {
  const t = await loadCanonicalTables(); const v = await view();
  // A claim whose membership went inactive is now stale → conflicting, not claimReady.
  const inactive = await runWithDb(spec(t, { claims: [claimRow()], memberships: [pcm({ membershipStatus: "inactive" })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(inactive.claims.rows[0].integrity, "conflicting", "(11) inactive membership → claim conflicting");
  assert.equal(inactive.claims.rows[0].claimReady, false, "stale claim never claimReady");
  // Merged global patient → conflicting.
  const merged = await runWithDb(spec(t, { claims: [claimRow()], globalPatients: [gpp({ mergedIntoPatientId: 999 })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(merged.claims.rows[0].integrity, "conflicting", "(12) merged global patient → claim conflicting");
}
async function testViewInvoiceLineageConflict() {
  const t = await loadCanonicalTables(); const v = await view();
  // Invoice evidence fingerprint disagrees with its claim → conflicting.
  const stale = await runWithDb(spec(t, { claims: [claimRow({ id: 700, evidenceFingerprint: "fp-1" })], invoices: [invoiceRow({ id: 800, claimId: 700, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-STALE" })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(stale.invoices.rows[0].integrity, "conflicting", "(13) stale invoice evidence → conflicting");
}
async function testViewDuplicateAcrossPagination() {
  const t = await loadCanonicalTables(); const v = await view();
  // Two active drafts for case 5 exist, but they fall on DIFFERENT pages — the
  // duplicate must still be detected via the complete-set aggregation.
  const claims = [claimRow({ id: 700, ancillaryCaseId: 5, canonicalStatus: "draft" }), claimRow({ id: 701, ancillaryCaseId: 9, canonicalStatus: "draft" }), claimRow({ id: 702, ancillaryCaseId: 5, canonicalStatus: "ready" })];
  const r = await runWithDb(spec(t, { claims }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1, limit: 1 }));
  assert.equal(r.claims.rows.length, 1); assert.equal(r.claims.rows[0].integrity, "conflicting", "(5) duplicate detection works across pagination boundaries");
}

// ═══ Route auth / flags / migration ═══
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; }, post: (p: string, ...h: Function[]) => { map[`POST ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(h: Function[], req: unknown, res: unknown) { for (const fn of h) { let nexted = false; await fn(req, res, () => { nexted = true; }); if (!nexted) return; } }
async function handler(path: string) { const { app, map } = fakeApp(); (await routes()).registerCanonicalFinancialRoutes(app); return map[`GET ${path}`]; }
async function testReadinessRouteIdentity() {
  const t = await loadCanonicalTables(); const h = await handler("/api/ancillary-cases/:id/canonical-claim-readiness");
  // Valid exact identity → claimReady true.
  const okRes = mockRes();
  await runWithDb(spec(t, { readiness: [readinessRow()], docs: [billingDocRow()] }), ALL, async () => { await invoke(h, { session: { userId: "u", role: "biller" }, clinicId: 1, params: { id: "5" }, query: {} }, okRes); });
  assert.equal((okRes.body as { claimReady: boolean }).claimReady, true, "(18) valid exact identity qualifies");
  // Wrong Billing Document membership → conflicting, never claimReady.
  const memRes = mockRes();
  await runWithDb(spec(t, { readiness: [readinessRow()], docs: [billingDocRow({ patientClinicMembershipId: 801 })] }), ALL, async () => { await invoke(h, { session: { userId: "u", role: "biller" }, clinicId: 1, params: { id: "5" }, query: {} }, memRes); });
  assert.equal((memRes.body as { integrity: string }).integrity, "conflicting", "(16) wrong Billing Document membership → conflicting");
  assert.equal((memRes.body as { claimReady: boolean }).claimReady, false);
  // Wrong Billing Document global patient → conflicting.
  const gpRes = mockRes();
  await runWithDb(spec(t, { readiness: [readinessRow()], docs: [billingDocRow({ globalPlexusPatientId: 901 })] }), ALL, async () => { await invoke(h, { session: { userId: "u", role: "biller" }, clinicId: 1, params: { id: "5" }, query: {} }, gpRes); });
  assert.equal((gpRes.body as { integrity: string }).integrity, "conflicting", "(17) wrong Billing Document global patient → conflicting");
}
async function testRouteAuth() {
  const h = await handler("/api/canonical-financial-view");
  const check = async (session: unknown, clinicId: unknown, expect: number) => { const res = mockRes(); await runWithDb(new Map(), { canonicalClaims: true }, async () => { await invoke(h, { session, clinicId, query: {} }, res); }); return res.statusCode === expect; };
  assert.ok(await check({}, 1, 401), "unauth → 401");
  assert.ok(await check({ userId: "u" }, 1, 403), "(17) missing role → 403");
  assert.ok(await check({ userId: "u", role: "wizard" }, 1, 403), "(18) unknown role → 403");
  assert.ok(await check({ userId: "u", role: "clinician" }, 1, 403), "(19) clinician (not biller/admin) → 403");
  assert.ok(await check({ userId: "u", role: "biller" }, null, 403), "(16) missing clinic scope → 403");
}
async function testRouteFlagOffDisabled() {
  const t = await loadCanonicalTables(); const h = await handler("/api/canonical-financial-view"); const res = mockRes();
  await runWithDb(spec(t, {}), { canonicalClaims: false, canonicalInvoices: false, canonicalPayments: false }, async (calls: Call[]) => {
    await invoke(h, { session: { userId: "u", role: "biller" }, clinicId: 1, query: {} }, res);
    assert.equal(countOps(calls, "select"), 0, "(5/93) disabled contract before schema access — zero reads");
  });
  assert.equal((res.body as { disabled: boolean }).disabled, true);
}
async function testRouteAllowedRoles() {
  const t = await loadCanonicalTables(); const h = await handler("/api/canonical-financial-view");
  for (const role of ["biller", "admin"]) { const res = mockRes(); await runWithDb(spec(t, {}), ALL, async () => { await invoke(h, { session: { userId: "u", role }, clinicId: 1, query: {} }, res); }); assert.equal(res.statusCode, 200, `${role} allowed`); }
}
async function testRouteMigration503() {
  const t = await loadCanonicalTables(); const h = await handler("/api/canonical-financial-view"); const res = mockRes();
  await runWithDb(spec(t, { claimsMig: true }), ALL, async () => { await invoke(h, { session: { userId: "u", role: "biller" }, clinicId: 1, query: {} }, res); });
  assert.equal(res.statusCode, 503, "(91) migration missing → 503"); assert.equal((res.body as { code: string }).code, "ANCILLARY_DOCUMENT_MIGRATION_MISSING");
}
async function testOrdinaryFailureUnavailable() {
  const t = await loadCanonicalTables(); const v = await view();
  const r = await runWithDb(spec(t, { invoicesErr: true, claims: [claimRow()] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.invoices.availability, "unavailable", "(92) ordinary read failure → unavailable, not empty"); assert.equal(r.claims.availability, "available");
}
async function testDisabledDtoNoFinancialLeak() {
  const d = await dto();
  const o = d.disabledCanonicalFinancialView(new Date().toISOString());
  assert.equal(o.disabled, true); assert.equal(o.claims.rows.length, 0);
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(50/77) money invariants", testMoney],
  ["(79-84) balance reconciliation", testBalance],
  ["(72-75) allocation validators", testAllocation],
  ["(22-36) claim readiness", testClaimReadiness],
  ["(40-49,57,59) state machines", testStateMachines],
  ["(5) view flags off zero reads", testViewFlagsAndReads],
  ["(79) view rows + balance, no leak", testViewRows],
  ["(90) view conflict + batched", testViewConflictAndBatch],
  ["(20) cross-clinic excluded", testViewCrossClinic],
  ["(86/89) pagination bounded", testViewPagination],
  ["(1/3) history not duplicate; active dup conflicts", testViewHistoryNotDuplicate],
  ["(11/12) claim lineage identity conflict", testViewClaimLineageConflict],
  ["(13) invoice lineage stale evidence conflict", testViewInvoiceLineageConflict],
  ["(5) duplicate detection across pagination", testViewDuplicateAcrossPagination],
  ["(16-18) readiness route identity", testReadinessRouteIdentity],
  ["(16-19) route auth", testRouteAuth],
  ["(5/93) route flag off disabled", testRouteFlagOffDisabled],
  ["route allowed roles", testRouteAllowedRoles],
  ["(91) migration 503", testRouteMigration503],
  ["(92) ordinary failure unavailable", testOrdinaryFailureUnavailable],
  ["disabled DTO", testDisabledDtoNoFinancialLeak],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
