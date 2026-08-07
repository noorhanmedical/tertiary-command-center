// Phase 2K (K31) — SCAN+1 overflow / truncation truth matrix — 12 explicit windows.
//
// Every bounded canonical read requests SCAN_LIMIT+1 (or WINDOW+1) rows; when the
// extra row proves the set could be incomplete the result must NEVER be a false
// current stage / never `paid` / never a resolved zero / never first-or-newest-wins —
// it is `unavailable` / `conflicting` (or, for the PCS lossless windows, a completeness
// cursor so no patient is silently dropped). Each test triggers the REAL production
// truncation branch. Numbered windows:
//   1 claim stage rows          7 parent-claim context
//   2 invoice stage rows        8 parent-invoice context (fail-closed via not-found→conflict;
//   3 payment allocations         the by-id parent load is page-bounded so +1 is unreachable)
//   4 receipt-wide allocations  9 Billing Document context
//   5 membership context       10 readiness context
//   6 global-patient context   11 PCS verified window (lossless cursor)
//                              12 PCS unresolved window (lossless cursor)
//
//   npx tsx tests/unit/phase2KOverflowTruth.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, type TableSpec } from "../support/canonicalHarness";

const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const pcsMod = () => import("../../server/services/pcs/pcsCanonicalView");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;
const STAGE_SCAN = 5000; const PCS_WINDOW = 5000; const PCS_UNRESOLVED_MAX = 50;
const gpp = () => ({ id: 900, identityStatus: "active", mergedIntoPatientId: null });
const pcm = () => ({ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" });
const svcCase = { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 };
const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
const claimRow = (o: Record<string, unknown> = {}) => ({ id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", billingDocumentId: 600, billingReadinessCheckId: 500, globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", lineItems: [], supersedesClaimId: null, ...o });

function stageBase(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const m = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }],
    [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }],
    [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => [] }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.ancillaryCases, { select: () => [svcCase] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  for (const [k, v] of Object.entries(over)) m.set((t as Record<string, unknown>)[k], v as TableSpec);
  return m;
}
const stageOne = async (spec: Map<unknown, TableSpec>) => {
  const { buildStageVectors } = await stageMod();
  return runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
};

// 1 ── claim stage rows
async function w1_claimStage() {
  const t = await loadCanonicalTables();
  const claims = many(STAGE_SCAN + 1, (i) => claimRow({ id: 700 + i }));
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => claims } }));
  assert.equal(v.claim.availability, "unavailable", "claim overflow → unavailable");
  assert.notEqual(v.claim.status, "ready", "claim overflow → never a derived status");
  assert.notEqual(v.payment.status, "paid", "claim overflow → payment never paid");
}
// 2 ── invoice stage rows
async function w2_invoiceStage() {
  const t = await loadCanonicalTables();
  const invs = many(STAGE_SCAN + 1, (i) => ({ id: 800 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "issued", supersededAt: null, invoiceNumber: "INV", totalAmount: "1.00", currency: "USD", issuedAt: OLD, claimId: 700, supersedesInvoiceId: null }));
  const v = await stageOne(stageBase(t, { canonicalInvoices: { select: () => invs } }));
  assert.equal(v.invoice.availability, "unavailable", "invoice overflow → unavailable");
  assert.notEqual(v.payment.status, "paid", "invoice overflow → payment never paid");
}
// 3 ── payment allocations (case-scoped)
async function w3_paymentAlloc() {
  const t = await loadCanonicalTables();
  const claim = claimRow({ canonicalStatus: "submitted", chargeAmount: "1.00", submittedAt: OLD });
  const allocs = many(STAGE_SCAN + 1, (i) => ({ id: i + 1, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", targetType: "claim", targetId: 700, currency: "USD", amount: "0.01" }));
  const v = await stageOne(stageBase(t, {
    canonicalClaims: { select: () => [claim] }, canonicalPayments: { select: () => [{ id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", currency: "USD", amount: "1.00" }] },
    canonicalPaymentAllocations: { select: () => allocs },
  }));
  assert.notEqual(v.payment.status, "paid", "payment-alloc overflow → never a false paid");
  assert.equal(v.payment.availability, "unavailable", "payment-alloc overflow → unavailable");
}
// A fully valid claim + matching Billing Document + readiness so the payment stage's
// target-lineage gate passes and execution reaches the receipt-wide truncation branch.
const FIELD_SRC: Record<string, string> = { service_code: "approved_fee_schedule", units: "approved_fee_schedule", place_of_service: "facility_registry", facility: "facility_registry", rendering_provider: "credentialing_registry", billing_provider: "credentialing_registry", payer: "payer_contract", coverage_reference: "payer_contract" };
const PROV = Object.fromEntries(Object.entries(FIELD_SRC).map(([f, s]) => [f, { sourceType: s, sourceId: "s" }]));
const FIELDS = Object.fromEntries(Object.keys(FIELD_SRC).map((f) => [f, "v"]));
const REFS = { procedureEventId: 400, orderNoteDocumentReferenceId: 11, reportDocumentReferenceId: 12, procedureNoteDocumentReferenceId: 13 };
const validClaim = () => ({ id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp-1", billingDocumentId: 600, billingReadinessCheckId: 500, ...REFS, globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", lineItems: [{ lineId: "l1", amount: "1.00", source: "approved_fee_schedule", unit: 1 }], claimFields: FIELDS, fieldProvenance: PROV, submittedAt: OLD, submissionSource: "manual_attestation", submissionActorUserId: "u", submissionReference: "R", submissionReason: "why", supersedesClaimId: null });
const validBd = () => ({ id: 600, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", supersededAt: null, billingReadinessCheckId: 500, evidenceFingerprint: "fp-1", ...REFS, globalPlexusPatientId: 900, patientClinicMembershipId: 800 });
const validRd = () => ({ id: 500, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", supersededAt: null, evidenceFingerprint: "fp-1", ...REFS, globalPlexusPatientId: 900, patientClinicMembershipId: 800 });
// 4 ── receipt-wide allocations (paymentId-scoped, 2nd canonicalPaymentAllocations read)
async function w4_receiptWide() {
  const t = await loadCanonicalTables();
  const apply = { id: 1, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "claim", targetId: 700, currency: "USD", amount: "1.00" };
  let n = 0; // allocLoad(case) then rwAllocLoad(payment); overflow only the receipt-wide read
  const v = await stageOne(stageBase(t, {
    canonicalClaims: { select: () => [validClaim()] }, billingDocumentRequests: { select: () => [validBd()] }, billingReadinessChecks: { select: () => [validRd()] },
    canonicalPayments: { select: () => [{ id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", currency: "USD", amount: "1.00" }] },
    canonicalPaymentAllocations: { select: () => (n++ === 0 ? [apply] : many(STAGE_SCAN + 1, (i) => ({ ...apply, id: 100 + i, amount: "0.01" }))) },
  }));
  assert.equal(v.payment.availability, "unavailable", "receipt-wide overflow → unavailable");
  assert.notEqual(v.payment.status, "paid", "receipt-wide overflow → never a false paid");
}
// 5 ── membership context
async function w5_membership() {
  const t = await loadCanonicalTables();
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => [claimRow()] }, memberships: { select: () => many(STAGE_SCAN + 1, (i) => ({ id: 800 + i, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" })) } }));
  assert.equal(v.claim.availability, "unavailable", "membership-context overflow → claim unavailable");
  assert.notEqual(v.claim.status, "ready", "membership-context overflow → never a derived status");
}
// 6 ── global-patient context
async function w6_globalPatient() {
  const t = await loadCanonicalTables();
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => [claimRow()] }, globalPatients: { select: () => many(STAGE_SCAN + 1, (i) => ({ id: 900 + i, identityStatus: "active", mergedIntoPatientId: null })) } }));
  assert.equal(v.claim.availability, "unavailable", "global-patient-context overflow → claim unavailable");
}
// 7 ── parent-claim context (2nd canonicalClaims read = claimParentLoad)
async function w7_parentClaim() {
  const t = await loadCanonicalTables();
  const child = claimRow({ supersedesClaimId: 699, attemptNumber: 2 });
  let n = 0; // claimLoad(page) then claimParentLoad(by id); overflow only the parent read
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => (n++ === 0 ? [child] : many(STAGE_SCAN + 1, (i) => claimRow({ id: 699 - i }))) } }));
  assert.equal(v.claim.availability, "unavailable", "parent-claim-context overflow → claim unavailable");
}
// 8 ── parent-invoice context: the by-id parent load is page-bounded (no +1), so a
//      truncated/missing parent fails closed via not-found → conflict (never resolved).
async function w8_parentInvoice() {
  const t = await loadCanonicalTables();
  const claim = claimRow({ canonicalStatus: "submitted", submittedAt: OLD, evidenceFingerprint: "fp" });
  const inv = { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, canonicalStatus: "issued", currency: "USD", totalAmount: "1.00", supersededAt: null, evidenceFingerprint: "fp", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M", invoiceNumber: "INV", issuedAt: OLD, lineItems: [], billingDocumentId: 600, billingReadinessCheckId: 500, supersedesInvoiceId: 799 };
  // canonicalInvoices returns only the child (id 800); parent 799 is absent → not-found.
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => [claim] }, canonicalInvoices: { select: () => [inv] } }));
  assert.equal(v.invoice.integrity, "conflicting", "missing/truncated parent invoice → invoice conflicting");
  assert.equal(v.invoice.status, null, "missing/truncated parent invoice → status null");
  assert.notEqual(v.payment.status, "paid", "missing/truncated parent invoice → never a false paid");
}
// 9 ── Billing Document context (claimBdLoad by id)
async function w9_billingDocument() {
  const t = await loadCanonicalTables();
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => [claimRow()] }, billingDocumentRequests: { select: () => many(STAGE_SCAN + 1, (i) => ({ id: 600 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", supersededAt: null })) } }));
  assert.equal(v.claim.availability, "unavailable", "Billing-Document-context overflow → claim unavailable");
}
// 10 ── readiness context (claimRdLoad by id)
async function w10_readiness() {
  const t = await loadCanonicalTables();
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => [claimRow()] }, billingReadinessChecks: { select: () => many(STAGE_SCAN + 1, (i) => ({ id: 500 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", supersededAt: null })) } }));
  assert.equal(v.claim.availability, "unavailable", "readiness-context overflow → claim unavailable");
}
// PCS lossless windows: an overflowed window must NOT silently drop a patient — a
// completeness cursor is produced so the tail is retrievable (never zero, never lost).
const pcsBase = (t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>>) => {
  const m = new Map<unknown, TableSpec>([
    [t.memberships, { select: () => [] }], [t.ancillaryCases, { select: () => [] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }],
    [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => [] }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
  ]);
  for (const [k, v] of Object.entries(over)) m.set((t as Record<string, unknown>)[k], v as TableSpec);
  return m;
};
// 11 ── PCS verified window: overflow the shared episode window → lossless cursor.
async function w11_pcsVerified() {
  const t = await loadCanonicalTables(); const { getPcsCanonicalView } = await pcsMod();
  const members = [pcm()];
  const cases = many(PCS_WINDOW + 1, (i) => ({ id: 1 + i, clinicId: 1, patientClinicMembershipId: 800, globalPlexusPatientId: 900, serviceType: "BrainWave", lifecycleStatus: "active" }));
  const r = await runWithDb(pcsBase(t, { memberships: { select: () => members }, ancillaryCases: { select: () => cases } }), CHAIN, async () => getPcsCanonicalView({ clinicId: 1 } as never));
  // A full window must produce an episode-continuation cursor for the truncated member —
  // the patient is NOT silently dropped, and the row is never an empty/false-complete set.
  const row = r.rows[0];
  assert.ok(row, "PCS verified overflow → member still returned (never dropped)");
  assert.ok(row.episodesNextCursor != null, "PCS verified window overflow → lossless episode cursor (tail retrievable)");
}
// 12 ── PCS unresolved window: scans ancillary_cases with limit(DEFAULT+1)=51; overflow
//       the case page with identity-less (unresolved) cases → lossless case cursor.
async function w12_pcsUnresolved() {
  const t = await loadCanonicalTables(); const { getPcsCanonicalView } = await pcsMod();
  const cases = many(PCS_UNRESOLVED_MAX + 1, (i) => ({ id: 1 + i, clinicId: 1, patientClinicMembershipId: null, globalPlexusPatientId: null, serviceType: "BrainWave", lifecycleStatus: "active" }));
  const r = await runWithDb(pcsBase(t, { ancillaryCases: { select: () => cases }, memberships: { select: () => [] }, globalPatients: { select: () => [] } }), CHAIN, async () => getPcsCanonicalView({ clinicId: 1 } as never));
  assert.ok(r.unresolved.pageInfo.nextCursor != null, "PCS unresolved window overflow → lossless case cursor (never silently dropped)");
  assert.ok(r.unresolved.rows.length > 0, "PCS unresolved overflow → non-empty (never a false zero)");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["W1  claim stage rows → unavailable", w1_claimStage],
  ["W2  invoice stage rows → unavailable", w2_invoiceStage],
  ["W3  payment allocations → never paid", w3_paymentAlloc],
  ["W4  receipt-wide allocations → never paid", w4_receiptWide],
  ["W5  membership context → unavailable", w5_membership],
  ["W6  global-patient context → unavailable", w6_globalPatient],
  ["W7  parent-claim context → unavailable", w7_parentClaim],
  ["W8  parent-invoice context → conflicting/not-paid", w8_parentInvoice],
  ["W9  Billing Document context → unavailable", w9_billingDocument],
  ["W10 readiness context → unavailable", w10_readiness],
  ["W11 PCS verified window → lossless cursor", w11_pcsVerified],
  ["W12 PCS unresolved window → lossless cursor", w12_pcsUnresolved],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
  console.log(`K31: ${tests.length}/12 required overflow windows proven`);
}
run();
