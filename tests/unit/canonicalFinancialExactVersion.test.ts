// Phase 2J exact-version closeout — active/historical version selection, Billing
// Document identity, field-specific provenance, idempotency race safety, external-
// transaction exactness, complete aggregation, tx-lock reload, exact-target stage.
//
//   npx tsx tests/unit/canonicalFinancialExactVersion.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const ver = () => import("../../server/services/canonicalFinancial/financialVersion");
const readiness = () => import("../../server/services/canonicalFinancial/claimReadiness");
const claimCmd = () => import("../../server/services/canonicalFinancial/claimCommands");
const paymentCmd = () => import("../../server/services/canonicalFinancial/paymentCommands");
const view = () => import("../../server/services/canonicalFinancial/financialView");
const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const cs = () => import("../../server/services/canonicalFinancial/commandSupport");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;

// ── §1 version selector (pure) ──
async function testVersionSelector() {
  const v = await ver();
  const claim = (s: string, o: Record<string, unknown> = {}) => ({ canonicalStatus: s, supersededAt: null, attemptNumber: 1, ...o });
  assert.equal(v.claimCaseIntegrity([claim("submitted", { attemptNumber: 1 }), claim("draft", { attemptNumber: 2 })]), "resolved", "(1) submitted history + correction draft NOT a conflict");
  assert.equal(v.claimCaseIntegrity([claim("draft"), claim("ready")]), "conflicting", "(3) two active working claims conflict");
  assert.equal(v.claimCaseIntegrity([claim("submitted", { attemptNumber: 1 }), claim("paid", { attemptNumber: 1 })]), "conflicting", "duplicate historical version identity conflicts");
  const inv = (s: string, o: Record<string, unknown> = {}) => ({ canonicalStatus: s, supersededAt: null, invoiceNumber: null, ...o });
  assert.equal(v.invoiceClaimIntegrity([inv("issued", { invoiceNumber: "INV-1" }), inv("draft")]), "resolved", "(2) issued history + correction draft NOT a conflict");
  assert.equal(v.invoiceClaimIntegrity([inv("draft"), inv("approved")]), "conflicting", "(4) two active working invoices conflict");
}

// ── §4/§5 readiness identity + provenance ──
function readinessRow(o: Record<string, unknown> = {}) { return { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, claimBlockers: [], warnings: [], ...o }; }
function fields(o: Record<string, unknown> = {}) {
  return {
    service_code: { value: "S", sourceType: "approved_fee_schedule" }, units: { value: "1", sourceType: "approved_fee_schedule" },
    place_of_service: { value: "11", sourceType: "facility_registry" }, facility: { value: "F", sourceType: "facility_registry" },
    rendering_provider: { value: "RP", sourceType: "credentialing_registry" }, billing_provider: { value: "BP", sourceType: "credentialing_registry" },
    payer: { value: "P", sourceType: "payer_contract" }, coverage_reference: { value: "C", sourceType: "payer_contract" }, ...o,
  };
}
function charge(o: Record<string, unknown> = {}) { return { amountSource: "approved_fee_schedule", currency: "USD", chargeAmount: "420.00", lineItems: [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }], fields: fields(), ...o }; }
function docRow(o: Record<string, unknown> = {}) { return { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13, procedureEventId: 400, globalPlexusPatientId: 900, patientClinicMembershipId: 800, sourceData: { claimCharge: charge() }, ...o }; }
const idc = { clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", verifiedGlobalPlexusPatientId: 900, verifiedPatientClinicMembershipId: 800 };

async function testProvenance() {
  const r = await readiness();
  const ok = r.evaluateClaimReadiness(idc, [readinessRow()] as never, [docRow()] as never);
  assert.ok(ok.claimReady, "(20) exact approved field provenance qualifies");
  const feePayer = r.evaluateClaimReadiness(idc, [readinessRow()] as never, [docRow({ sourceData: { claimCharge: charge({ fields: fields({ payer: { value: "P", sourceType: "approved_fee_schedule" } }) }) } })] as never);
  assert.ok(!feePayer.claimReady && feePayer.blockers.some((b) => b.code === "claim_field_provenance_invalid_payer"), "(18) fee schedule does not prove payer");
  const feeProvider = r.evaluateClaimReadiness(idc, [readinessRow()] as never, [docRow({ sourceData: { claimCharge: charge({ fields: fields({ rendering_provider: { value: "RP", sourceType: "approved_fee_schedule" } }) }) } })] as never);
  assert.ok(!feeProvider.claimReady && feeProvider.blockers.some((b) => b.code === "claim_field_provenance_invalid_rendering_provider"), "(19) fee schedule does not prove provider");
  const missProv = r.evaluateClaimReadiness(idc, [readinessRow()] as never, [docRow({ sourceData: { claimCharge: charge({ fields: fields({ payer: { value: "P" } }) }) } })] as never);
  assert.ok(missProv.blockers.some((b) => b.code === "claim_field_provenance_invalid_payer"), "(17) missing field-specific provenance blocks");
}
async function testBillingDocIdentity() {
  const r = await readiness();
  const memMismatch = r.evaluateClaimReadiness(idc, [readinessRow()] as never, [docRow({ patientClinicMembershipId: 801 })] as never);
  assert.ok(!memMismatch.claimReady && memMismatch.integrity === "conflicting" && memMismatch.blockers.some((b) => b.code === "billing_document_identity_mismatch"), "(12) wrong Billing Document membership conflicts");
  const gpMismatch = r.evaluateClaimReadiness(idc, [readinessRow()] as never, [docRow({ globalPlexusPatientId: 901 })] as never);
  assert.ok(!gpMismatch.claimReady && gpMismatch.blockers.some((b) => b.code === "billing_document_identity_mismatch"), "(13) wrong Billing Document global patient conflicts");
}

// ── §7/§8/§9/§10 command tests (fake db) ──
function acase(o: Record<string, unknown> = {}) { return { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800, ...o }; }
function gpp(o: Record<string, unknown> = {}) { return { id: 900, identityStatus: "active", mergedIntoPatientId: null, ...o }; }
function pcm(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active", ...o }; }
function paymentRow(o: Record<string, unknown> = {}) { return { id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", paymentType: "manual", status: "posted", currency: "USD", amount: "420.00", ...o }; }
function invoiceRow(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, canonicalStatus: "issued", currency: "USD", totalAmount: "1000.00", supersededAt: null, evidenceFingerprint: "fp-1", ...o }; }
function applyAlloc(o: Record<string, unknown> = {}) { return { id: 950, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "1.00", ...o }; }
const ins = (id: number) => (v: Record<string, unknown>) => [{ ...v, id }];
function seq<T>(...vals: T[][]) { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; }

async function testIdempotencyRaceSafe() {
  const t = await loadCanonicalTables(); const c = await claimCmd(); const { commandFingerprint } = await cs();
  const other = { entityType: "claim", clinicId: 1, idempotencyKey: "k1", entityId: 700, commandFingerprint: "OTHER-INTENT" };
  // Entry gate sees NO prior; insert loses the race (23505); post-recovery reloads the
  // audit row (different fingerprint) → idempotency_conflict, never reuse the winner.
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [acase()] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.billingReadinessChecks, { select: () => [readinessRow()] }], [t.billingDocumentRequests, { select: () => [docRow()] }],
    [t.canonicalClaims, { select: () => [], onInsert: () => { throw Object.assign(new Error("dup"), { code: "23505" }); } }],
    [t.canonicalFinancialTransitions, { select: seq([], [other]) }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "k1" }));
  assert.equal(r.status, "idempotency_conflict", "(24/25) unique-violation recovery compares fingerprint — cannot reuse a different-intent winner");
  void commandFingerprint;
}
async function testIdempotencyRequired() {
  const t = await loadCanonicalTables(); const c = await claimCmd();
  const spec = new Map<unknown, TableSpec>([[t.canonicalClaims, { select: () => [] }], [t.canonicalFinancialTransitions, { select: () => [] }]]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await c.createOrReuseCanonicalClaimDraft({ clinicId: 1, ancillaryCaseId: 5, actorUserId: "u", actorRole: "biller", idempotencyKey: "" }); assert.equal(countOps(calls, "select"), 0, "(21) missing key → zero reads/writes"); return res; });
  assert.equal(r.status, "idempotency_required", "(21) missing idempotency key rejected before any read");
}
function payBase(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const m = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [acase()] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.canonicalPayments, { select: () => [paymentRow()], onInsert: ins(901) }],
    [t.canonicalInvoices, { select: () => [invoiceRow()], onUpdate: (v) => [{ ...v, id: 800 }] }],
    [t.canonicalClaims, { select: () => [], onUpdate: (v) => [{ ...v, id: 700 }] }],
    [t.canonicalPaymentAllocations, { select: () => [], onInsert: ins(960) }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: ins(1) }],
  ]);
  for (const [k, v] of Object.entries(over)) m.set((t as Record<string, unknown>)[k], v);
  return m;
}
async function testExternalTxnCaseCurrencyConflict() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const caseMismatch = payBase(t, { canonicalPayments: { select: () => [paymentRow({ externalTransactionId: "X", ancillaryCaseId: 6, amount: "5.00", paymentType: "processor_import", sourceSystem: "s" })], onInsert: ins(901) } });
  const r1 = await runWithDb(caseMismatch, CHAIN, async () => p.recordCanonicalPayment({ clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", paymentType: "processor_import", currency: "USD", amount: "5.00", externalTransactionId: "X", actorUserId: "u", actorRole: "biller", sourceSystem: "s", idempotencyKey: "k" }));
  assert.equal(r1.status, "external_transaction_conflict", "(28) external transaction different case conflicts");
  const curMismatch = payBase(t, { canonicalPayments: { select: () => [paymentRow({ externalTransactionId: "X", ancillaryCaseId: null, amount: "5.00", currency: "USD", paymentType: "processor_import", sourceSystem: "s" })], onInsert: ins(901) } });
  const r2 = await runWithDb(curMismatch, CHAIN, async () => p.recordCanonicalPayment({ clinicId: 1, paymentType: "processor_import", currency: "USD", amount: "6.00", externalTransactionId: "X", actorUserId: "u", actorRole: "biller", sourceSystem: "s", idempotencyKey: "k" }));
  assert.equal(r2.status, "external_transaction_conflict", "(29) external transaction different amount/currency conflicts");
}
async function testAllocationTruncationBound() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const many = Array.from({ length: 2001 }, (_, i) => applyAlloc({ id: 1000 + i, amount: "0.01" }));
  const spec = payBase(t, { canonicalPaymentAllocations: { select: () => many, onInsert: ins(960) } });
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "1.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no insert on truncated set"); return res; });
  assert.equal(r.status, "allocation_integrity_unavailable", "(30/31/33) a truncated allocation set never yields a bound");
}
async function testTxLockReloadConflict() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Pre-tx read sees fp-1; the under-lock reload sees fp-2 (evidence changed) → conflict.
  const spec = payBase(t, { canonicalInvoices: { select: seq([invoiceRow({ evidenceFingerprint: "fp-1" })], [invoiceRow({ evidenceFingerprint: "fp-2" })]), onUpdate: (v) => [{ ...v, id: 800 }] } });
  const r = await runWithDb(spec, CHAIN, async () => p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "invoice", targetId: 800, amount: "1.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a" }));
  assert.equal(r.status, "conflict", "(35) target evidence changed before lock → conflict");
}
async function testAllocateLineageStaleTargetRejected() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // A claim STILL payable (submitted) but whose global patient was merged AFTER
  // creation. The read model flags it conflicting; the WRITE path must equally refuse
  // to drive it to paid — a conflicting/invalid target can never produce paid.
  const staleClaim = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp-1", billingDocumentId: 600, billingReadinessCheckId: 500, globalPlexusPatientId: 900, patientClinicMembershipId: 800, submittedAt: OLD, submissionSource: "manual_attestation", currency: "USD", chargeAmount: "420.00", updatedAt: OLD };
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [acase()] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp({ mergedIntoPatientId: 901 })] }],
    [t.canonicalPayments, { select: () => [paymentRow()], onInsert: ins(901) }],
    [t.canonicalClaims, { select: () => [staleClaim], onUpdate: (v) => [{ ...v, id: 700 }] }],
    [t.canonicalInvoices, { select: () => [] }],
    [t.canonicalPaymentAllocations, { select: () => [], onInsert: ins(960) }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: ins(1) }],
  ]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => {
    const res = await p.allocateCanonicalPayment({ clinicId: 1, paymentId: 900, targetType: "claim", targetId: 700, amount: "420.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "a" });
    assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no allocation inserted for a lineage-stale target");
    assert.equal(countOps(calls, "update", t.canonicalClaims), 0, "lineage-stale target never driven to paid");
    return res;
  });
  assert.ok(r.status === "allocation_rejected" && r.code === "claim_global_patient_merged", "(43) lineage-stale but payable target rejected before paid");
}

function applyParent(o: Record<string, unknown> = {}) { return { id: 950, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00", ...o }; }
function negBase(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const m = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [acase()] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.canonicalPayments, { select: () => [paymentRow()] }],
    [t.canonicalInvoices, { select: () => [invoiceRow({ id: 800, totalAmount: "420.00", canonicalStatus: "paid" })], onUpdate: (v) => [{ ...v, id: 800 }] }],
    [t.canonicalPaymentAllocations, { select: () => [applyParent()], onInsert: ins(970) }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: ins(1) }],
  ]);
  for (const [k, v] of Object.entries(over)) m.set((t as Record<string, unknown>)[k], v);
  return m;
}
async function testNegateAtomicTruncation() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // A truncated TARGET allocation set discovered under the lock → zero committed rows.
  const many = [applyParent(), ...Array.from({ length: 2001 }, (_, i) => applyParent({ id: 2000 + i, targetId: 800 }))];
  const spec = negBase(t, { canonicalPaymentAllocations: { select: () => many, onInsert: ins(970) } });
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no negation inserted on truncation"); assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 0, "no audit on truncation"); return res; });
  assert.equal(r.status, "allocation_integrity_unavailable", "(26) target truncation after lock commits zero negation rows");
}
async function testNegateMissingTarget() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = negBase(t, { canonicalInvoices: { select: () => [] } });
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no negation inserted"); return res; });
  assert.equal(r.status, "target_not_found", "(27) missing target commits zero negation rows");
}
async function testNegateSupersededTarget() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = negBase(t, { canonicalInvoices: { select: () => [invoiceRow({ id: 800, totalAmount: "420.00", supersededAt: OLD })] } });
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no negation inserted"); return res; });
  assert.equal(r.status, "conflict", "(28) superseded target commits zero negation rows");
}
async function testNegateZeroRowTargetUpdate() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Target update affects zero rows (concurrent status change) → THROW → rollback.
  const spec = negBase(t, { canonicalInvoices: { select: () => [invoiceRow({ id: 800, totalAmount: "420.00", canonicalStatus: "paid" })], onUpdate: () => [] } });
  const r = await runWithDb(spec, CHAIN, async () => p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }));
  assert.equal(r.status, "conflict", "(29) zero-row target update rolls back negation and audit");
}
async function testNegateWrongService() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // Target invoice service disagrees with its canonical case → no write.
  const spec = negBase(t, { ancillaryCases: { select: () => [acase({ serviceType: "NerveGuard" })] } });
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no write on wrong service"); return res; });
  assert.equal(r.status, "case_service_mismatch", "(22/33) refund with wrong service rejected");
}

async function testNegatePendingReceipt() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  // A pending (unverified) receipt cannot be refunded.
  const spec = negBase(t, { canonicalPayments: { select: () => [paymentRow({ status: "pending" })] } });
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => { const res = await p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }); assert.equal(countOps(calls, "insert", t.canonicalPaymentAllocations), 0, "no write on pending receipt"); return res; });
  assert.equal(r.status, "target_not_payable", "(36) pending receipt cannot be refunded");
  const failed = negBase(t, { canonicalPayments: { select: () => [paymentRow({ status: "failed" })] } });
  const r2 = await runWithDb(failed, CHAIN, async () => p.refundCanonicalPayment({ clinicId: 1, paymentId: 900, allocationId: 950, amount: "10.00", actorUserId: "u", actorRole: "biller", idempotencyKey: "r" }));
  assert.equal(r2.status, "target_not_payable", "(37) failed receipt cannot be refunded");
}
async function testReadModelStatusNull() {
  const t = await loadCanonicalTables(); const v = await view();
  // A conflicting invoice (stale evidence) must show status null, never the raw status.
  const claimRow = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp-1", billingDocumentId: 600, billingReadinessCheckId: 500, globalPlexusPatientId: 900, patientClinicMembershipId: 800, submittedAt: OLD, submissionSource: "manual_attestation", currency: "USD", chargeAmount: "420.00", updatedAt: OLD };
  const invStale = { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-STALE", canonicalStatus: "issued", invoiceType: "patient", recipientType: "patient_membership", invoiceNumber: "INV-1", currency: "USD", totalAmount: "420.00", supersededAt: null, issuedAt: OLD };
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => [claimRow] }], [t.canonicalInvoices, { select: () => [invStale] }],
    [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.ancillaryCases, { select: () => [acase()] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => v.getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.invoices.rows[0].integrity, "conflicting"); assert.equal(r.invoices.rows[0].status, null, "(7) conflicting invoice → status null, never a stale raw status");
}
async function testStageClaimScanOverflow() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  // >SCAN_LIMIT claims → claim stage unavailable, never derived from a partial set.
  const many = Array.from({ length: 5001 }, (_, i) => ({ id: 700 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp-1", globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD" }));
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => many }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [acase() as never] }))[0]);
  assert.equal(v.claim.availability, "unavailable", "(31) claim scan overflow → unavailable"); assert.ok(v.claim.warnings.includes("financial_stage_data_truncated"));
  assert.equal(v.payment.availability, "unavailable", "(35) no false paid stage from truncated rows");
}

// ── §11 exact-target payment stage ──
async function testStageExactTarget() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const svcCase = { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 };
  // Coherent evidence so the COMPLETE target lineage validator passes (else the payment
  // stage gates to payment_target_lineage_conflict before any balance is derived).
  const REFS = { procedureEventId: 400, orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13 };
  const ID = { globalPlexusPatientId: 900, patientClinicMembershipId: 800 };
  const LN = [{ lineId: "l1", amount: "420.00", source: "approved_fee_schedule", unit: 1 }];
  const FSRC: Record<string, string> = { service_code: "approved_fee_schedule", units: "approved_fee_schedule", place_of_service: "facility_registry", facility: "facility_registry", rendering_provider: "credentialing_registry", billing_provider: "credentialing_registry", payer: "payer_contract", coverage_reference: "payer_contract" };
  const PV = Object.fromEntries(Object.entries(FSRC).map(([f, s]) => [f, { sourceType: s, sourceId: "s" }]));
  const CF = Object.fromEntries(Object.keys(FSRC).map((f) => [f, "v"]));
  const rd = { id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready_to_generate", supersededAt: null, evidenceFingerprint: "fp-1", ...REFS, ...ID };
  const bd = { id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "generated", supersededAt: null, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...REFS, ...ID };
  const claimT = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, supersedesClaimId: null, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...REFS, ...ID, chargeAmount: "420.00", currency: "USD", lineItems: LN, claimFields: CF, fieldProvenance: PV, updatedAt: OLD, submittedAt: OLD, submissionSource: "manual_attestation", submissionActorUserId: "u", submissionReference: "REF-1", submissionReason: "attested" };
  const invT = { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, billingDocumentId: 600, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", canonicalStatus: "issued", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M-1", supersedesInvoiceId: null, supersededAt: null, invoiceNumber: "INV-1-800", totalAmount: "420.00", currency: "USD", lineItems: LN, issuedAt: OLD, deliveredAt: null, deliveryEventReference: null };
  const mig = () => { throw Object.assign(new Error("x"), { code: "42P01" }); };
  // Alloc to the CLAIM (799) and to a WRONG invoice (799) must be excluded when the
  // active target is invoice 800; only the 420 apply to invoice 800 counts → paid.
  // Excluded allocations live on OTHER receipts (901/902) so receipt 900 — the one
  // funding the selected invoice 800 — is not receipt-wide over-allocated.
  const allocs = [
    { id: 1, clinicId: 1, paymentId: 901, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", targetType: "claim", targetId: 700, currency: "USD", amount: "999.00" },
    { id: 2, clinicId: 1, paymentId: 902, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", targetType: "invoice", targetId: 799, currency: "USD", amount: "999.00" },
    { id: 3, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", targetType: "invoice", targetId: 800, currency: "USD", amount: "420.00" },
  ];
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }],
    [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }],
    [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [rd] }], [t.billingDocumentRequests, { select: () => [bd] }],
    [t.canonicalClaims, { select: () => [claimT] }], [t.canonicalInvoices, { select: () => [invT] }], [t.canonicalPayments, { select: () => [paymentRow()] }],
    [t.canonicalPaymentAllocations, { select: () => allocs } ],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.ancillaryCases, { select: () => [svcCase] }],
  ]);
  void mig;
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
  assert.equal(v.payment.status, "paid", "(39/40/42) only allocations for the exact active invoice count → paid");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1-4) version selector active/historical", testVersionSelector],
  ["(17-20) field-specific provenance", testProvenance],
  ["(12/13) Billing Document identity", testBillingDocIdentity],
  ["(24/25) idempotency race-safe recovery", testIdempotencyRaceSafe],
  ["(21) idempotency key required", testIdempotencyRequired],
  ["(28/29) external-txn case/amount conflict", testExternalTxnCaseCurrencyConflict],
  ["(30/31/33) allocation truncation bound", testAllocationTruncationBound],
  ["(35) tx-lock reload conflict", testTxLockReloadConflict],
  ["(43) allocate lineage-stale target rejected", testAllocateLineageStaleTargetRejected],
  ["(26) negate truncation zero writes", testNegateAtomicTruncation],
  ["(27) negate missing target zero writes", testNegateMissingTarget],
  ["(28) negate superseded target zero writes", testNegateSupersededTarget],
  ["(29) negate zero-row update rolls back", testNegateZeroRowTargetUpdate],
  ["(22/33) negate wrong service rejected", testNegateWrongService],
  ["(36/37) negate pending/failed receipt rejected", testNegatePendingReceipt],
  ["(7) read-model conflicting status null", testReadModelStatusNull],
  ["(31/35) stage claim scan overflow unavailable", testStageClaimScanOverflow],
  ["(39/40/42) exact-target payment stage", testStageExactTarget],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
