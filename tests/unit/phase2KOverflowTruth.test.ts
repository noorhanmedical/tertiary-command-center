// Phase 2K (K31) — SCAN+1 overflow / truncation truth matrix.
//
// Every bounded canonical read requests SCAN_LIMIT+1 rows; when the extra row proves
// the set could be incomplete, the result must NEVER be a false current stage / never
// `paid` / never a resolved zero / never first-or-newest-wins — it is `unavailable` or
// `conflicting` per the established contract. This exercises the real overflow paths.
//
//   npx tsx tests/unit/phase2KOverflowTruth.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, type TableSpec } from "../support/canonicalHarness";

const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const viewMod = () => import("../../server/services/canonicalFinancial/financialView");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;
const STAGE_SCAN = 5000; const FIN_SCAN = 2000;
const gpp = () => ({ id: 900, identityStatus: "active", mergedIntoPatientId: null });
const pcm = () => ({ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" });
const svcCase = { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 };
const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));

function stageBase(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const m = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }],
    [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }],
    [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => [] }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  for (const [k, v] of Object.entries(over)) m.set((t as Record<string, unknown>)[k], v as TableSpec);
  return m;
}
const stageOne = async (spec: Map<unknown, TableSpec>) => {
  const { buildStageVectors } = await stageMod();
  return runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
};

// ── stage: claim / invoice / payment overflow → unavailable, never a false stage ──
async function testStageClaimOverflow() {
  const t = await loadCanonicalTables();
  const claims = many(STAGE_SCAN + 1, (i) => ({ id: 700 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD" }));
  const v = await stageOne(stageBase(t, { canonicalClaims: { select: () => claims } }));
  assert.equal(v.claim.availability, "unavailable", "claim overflow → unavailable");
  assert.notEqual(v.claim.status, "ready", "claim overflow → never a derived status");
  assert.notEqual(v.payment.status, "paid", "claim overflow → payment never paid");
}
async function testStageInvoiceOverflow() {
  const t = await loadCanonicalTables();
  const invs = many(STAGE_SCAN + 1, (i) => ({ id: 800 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "issued", supersededAt: null, invoiceNumber: "INV", totalAmount: "1.00", currency: "USD", issuedAt: OLD }));
  const v = await stageOne(stageBase(t, { canonicalInvoices: { select: () => invs } }));
  assert.equal(v.invoice.availability, "unavailable", "invoice overflow → unavailable");
  assert.notEqual(v.payment.status, "paid", "invoice overflow → payment never paid");
}
async function testStagePaymentAllocOverflow() {
  const t = await loadCanonicalTables();
  const claim = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", submittedAt: OLD };
  const allocs = many(STAGE_SCAN + 1, (i) => ({ id: i + 1, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", targetType: "claim", targetId: 700, currency: "USD", amount: "0.01" }));
  const v = await stageOne(stageBase(t, {
    canonicalClaims: { select: () => [claim] }, canonicalPayments: { select: () => [{ id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", currency: "USD", amount: "1.00" }] },
    canonicalPaymentAllocations: { select: () => allocs },
  }));
  assert.notEqual(v.payment.status, "paid", "allocation overflow → never a false paid");
  assert.equal(v.payment.availability, "unavailable", "allocation overflow → unavailable");
}

// ── financial view: allocation overflow → invoice conflicting, never a resolved zero ──
async function testViewAllocOverflow() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  const invoice = { id: 800, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", claimId: 700, canonicalStatus: "issued", currency: "USD", totalAmount: "1000.00", supersededAt: null, evidenceFingerprint: "fp", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M", invoiceNumber: "INV", issuedAt: OLD, lineItems: [], billingDocumentId: 600, billingReadinessCheckId: 500 };
  const claim = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", billingDocumentId: 600, billingReadinessCheckId: 500, globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1000.00", lineItems: [], submittedAt: OLD };
  const allocs = many(FIN_SCAN + 1, (i) => ({ id: i + 1, clinicId: 1, paymentId: 900, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", targetType: "invoice", targetId: 800, currency: "USD", amount: "0.01" }));
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => [claim] }], [t.canonicalInvoices, { select: () => [invoice] }],
    [t.canonicalPayments, { select: () => [{ id: 900, clinicId: 1, eventType: "payment", status: "posted", currency: "USD", amount: "1000.00", ancillaryCaseId: 5, serviceType: "BrainWave" }] }],
    [t.canonicalPaymentAllocations, { select: () => allocs }],
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave" }] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  const row = r.invoices.rows[0];
  assert.equal(row.integrity, "conflicting", "alloc overflow → invoice conflicting");
  assert.notEqual(row.balance.outstanding, "0.00", "alloc overflow → never a resolved zero outstanding");
}
async function testViewClaimAggOverflow() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  const claims = many(FIN_SCAN + 1, (i) => ({ id: 700 + i, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "ready", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", lineItems: [], updatedAt: OLD }));
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: () => claims }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.ancillaryCases, { select: () => [] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.availability, "unavailable", "claim duplicate-detection overflow → unavailable (never a partial page)");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["stage claim overflow → unavailable", testStageClaimOverflow],
  ["stage invoice overflow → unavailable", testStageInvoiceOverflow],
  ["stage payment allocation overflow → never paid", testStagePaymentAllocOverflow],
  ["financial view alloc overflow → conflicting, never zero", testViewAllocOverflow],
  ["financial view claim-agg overflow → unavailable", testViewClaimAggOverflow],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
