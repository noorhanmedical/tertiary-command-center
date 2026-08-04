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
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", ...o }; }
function readinessRow(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, claimBlockers: [], warnings: [], ...o }; }
function billingDocRow(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, globalPlexusPatientId: 900, patientClinicMembershipId: 800, sourceData: { chargeAmount: "420.00", amountSource: "approved_fee_schedule" }, ...o }; }
function claimRow(o: Record<string, unknown> = {}) { return { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", attemptNumber: 1, supersedesClaimId: null, supersededAt: null, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", currency: "USD", chargeAmount: "420.00", claimSubmissionBlockers: [], warnings: [], submittedAt: null, submissionSource: null, updatedAt: OLD, ...o }; }
function invoiceRow(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, canonicalStatus: "issued", invoiceType: "patient", recipientType: "patient_membership", invoiceNumber: "INV-1", currency: "USD", totalAmount: "420.00", supersededAt: null, issuedAt: OLD, deliveredAt: null, warnings: [], ...o }; }
function paymentRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, invoiceId: 800, eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "100.00", externalTransactionId: null, reversesPaymentId: null, postedAt: OLD, ...o }; }

function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, o: { claims?: unknown[]; invoices?: unknown[]; payments?: unknown[]; cases?: unknown[]; readiness?: unknown[]; docs?: unknown[]; claimsMig?: boolean; invoicesErr?: boolean } = {}) {
  const mig = () => { throw Object.assign(new Error("relation missing"), { code: "42P01" }); };
  return new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => { if (o.claimsMig) return mig(); return o.claims ?? []; } }],
    [t.canonicalInvoices, { select: () => { if (o.invoicesErr) throw new Error("inv down"); return o.invoices ?? []; } }],
    [t.canonicalPayments, { select: () => o.payments ?? [] }],
    [t.ancillaryCases, { select: () => o.cases ?? [acase()] }],
    [t.billingReadinessChecks, { select: () => o.readiness ?? [] }],
    [t.billingDocumentRequests, { select: () => o.docs ?? [] }],
  ]);
}

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
  const r = await runWithDb(spec(t, { claims: [claimRow()], invoices: [invoiceRow()], payments: [paymentRow({ amount: "100.00" })] }), ALL, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.rows.length, 1); assert.equal(r.claims.rows[0].status, "ready");
  assert.equal(r.invoices.rows.length, 1);
  assert.equal(r.invoices.rows[0].balance.paidAmount, "100.00"); assert.equal(r.invoices.rows[0].balance.outstandingBalance, "320.00", "(79) invoice balance reconciles from ledger");
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
  // batched payment read for invoice balances (one query for many invoices)
  await runWithDb(spec(t, { invoices: [invoiceRow({ id: 800 }), invoiceRow({ id: 801 })], payments: [paymentRow({ invoiceId: 800 }), paymentRow({ id: 901, invoiceId: 801 })] }), ALL, async (calls: Call[]) => {
    await v.getCanonicalFinancialView({ clinicId: 1 });
    assert.equal(countOps(calls, "select", t.canonicalPayments), 1 + 1, "(90) one batched ledger read for invoices + one payments-section read (no per-invoice N+1)");
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

// ═══ Route auth / flags / migration ═══
function fakeApp() { const map: Record<string, Function[]> = {}; return { app: { get: (p: string, ...h: Function[]) => { map[`GET ${p}`] = h; } } as never, map }; }
function mockRes() { return { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } }; }
async function invoke(h: Function[], req: unknown, res: unknown) { for (const fn of h) { let nexted = false; await fn(req, res, () => { nexted = true; }); if (!nexted) return; } }
async function handler(path: string) { const { app, map } = fakeApp(); (await routes()).registerCanonicalFinancialRoutes(app); return map[`GET ${path}`]; }
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
