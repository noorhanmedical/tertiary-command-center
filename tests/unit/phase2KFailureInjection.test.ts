// Phase 2K (K38) — ordinary (non-migration) failure-injection: fail closed.
//
// An ordinary DB read/write failure on a critical canonical path must never fabricate
// success: reads degrade to `unavailable` (never empty-as-success), writes leave no
// false committed state, a post-insert failure rolls back to a conflict, and a
// throwing target update never yields a false `paid`.
//
//   npx tsx tests/unit/phase2KFailureInjection.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const viewMod = () => import("../../server/services/canonicalFinancial/financialView");
const paymentCmd = () => import("../../server/services/canonicalFinancial/paymentCommands");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;
const boom = () => { throw new Error("db read down"); };
const gpp = () => ({ id: 900, identityStatus: "active", mergedIntoPatientId: null });
const pcm = () => ({ id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active" });
const svcCase = { id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 };

// ── financial view: an ordinary section read failure → unavailable, not empty-success ──
async function testViewReadFailure() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  const spec = new Map<unknown, TableSpec>([
    [t.canonicalClaims, { select: boom }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.ancillaryCases, { select: () => [] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async () => getCanonicalFinancialView({ clinicId: 1 }));
  assert.equal(r.claims.availability, "unavailable", "claims read failure → unavailable");
  assert.equal(r.claims.rows.length, 0, "no rows — but availability marks it unavailable (never empty-as-success)");
  assert.ok(r.claims.warnings.length > 0, "a PHI-free failure warning is surfaced");
}

// ── stage: claim read failure → claim stage unavailable ──
async function testStageReadFailure() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: boom }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
  assert.equal(v.claim.availability, "unavailable", "claim read failure → unavailable, never a false stage");
}

// ── stage: receipt-wide load failure → payment unavailable, never a false paid ──
async function testStageReceiptWideReadFailure() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const claim = { id: 700, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", canonicalStatus: "submitted", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", submittedAt: OLD };
  const alloc = { id: 1, paymentId: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "apply", parentAllocationId: null, targetType: "claim", targetId: 700, currency: "USD", amount: "1.00" };
  const receipt = [{ id: 900, clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", eventType: "payment", status: "posted", currency: "USD", amount: "1.00" }];
  let ap = 0; // 1st canonicalPaymentAllocations select = case load (ok), 2nd = receipt-wide load (throws)
  const spec = new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }], [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }], [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }], [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => [claim] }], [t.canonicalInvoices, { select: () => [] }], [t.canonicalPayments, { select: () => receipt }], [t.canonicalPaymentAllocations, { select: () => { ap++; if (ap >= 2) boom(); return [alloc]; } }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
  ]);
  const v = await runWithDb(spec, CHAIN, async () => (await buildStageVectors({ clinicId: 1, cases: [svcCase as never] }))[0]);
  assert.notEqual(v.payment.status, "paid", "receipt-wide read failure → never a false paid");
  assert.equal(v.payment.availability, "unavailable", "receipt-wide read failure → unavailable");
}

// ── payment receipt write failure (insert throws) → no committed state / audit ──
async function testRecordPaymentWriteFailure() {
  const t = await loadCanonicalTables(); const p = await paymentCmd();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 5, clinicId: 1, serviceType: "BrainWave", globalPlexusPatientId: 900, patientClinicMembershipId: 800 }] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    // The receipt insert throws an ORDINARY error mid-transaction.
    [t.canonicalPayments, { select: () => [], onInsert: boom }],
    [t.canonicalFinancialTransitions, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const r = await runWithDb(spec, CHAIN, async (calls: Call[]) => {
    const res = await p.recordCanonicalPayment({ clinicId: 1, ancillaryCaseId: 5, serviceType: "BrainWave", paymentType: "manual", currency: "USD", amount: "1.00", actorUserId: "u", actorRole: "biller", sourceSystem: "s", idempotencyKey: "k" });
    assert.equal(countOps(calls, "insert", t.canonicalFinancialTransitions), 0, "receipt insert failure → zero audit committed (writeTransition never runs)");
    return res;
  });
  assert.equal(r.status, "persistence_failed", "receipt write failure → persistence_failed, no false success");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["financial view read failure → unavailable", testViewReadFailure],
  ["stage claim read failure → unavailable", testStageReadFailure],
  ["stage receipt-wide read failure → never a false paid", testStageReceiptWideReadFailure],
  ["payment receipt write failure → no committed state", testRecordPaymentWriteFailure],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
