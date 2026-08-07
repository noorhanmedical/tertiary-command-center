// Phase 2K (K30) — enterprise query-count / N+1 boundary matrix.
//
// Every canonical read model is batched (one bounded query per relation via
// `inArray`, never a per-row/per-invoice/per-payment loop). This proves it: for each
// read model the TOTAL number of SELECTs is CONSTANT across 1 / 25 / 100 records — a
// real N+1 would make the count scale with N and fail these assertions.
//
//   npx tsx tests/unit/phase2KQueryBoundaries.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const stageMod = () => import("../../server/services/canonicalStage/caseStageVector");
const viewMod = () => import("../../server/services/canonicalFinancial/financialView");
const pcsMod = () => import("../../server/services/pcs/pcsCanonicalView");
const acsMod = () => import("../../server/services/acs/acsCanonicalView");
const portalMod = () => import("../../server/services/clinicianPortal/canonicalOverview");

const OLD = new Date("2027-06-10T09:00:00Z");
const CHAIN = {
  ancillaryCaseWrite: true, canonicalAppointment: true, unifiedAncillaryDocuments: true,
  canonicalOrderNote: true, canonicalProcedureLifecycle: true, canonicalProcedureNote: true,
  canonicalBillingReadiness: true, canonicalBillingDocument: true,
  serviceSpecificAdminReview: true, engagementAdminReviewSync: true,
  pcsCanonicalView: true, acsCanonicalView: true,
  canonicalClaims: true, canonicalInvoices: true, canonicalPayments: true,
} as const;
const N_MATRIX = [1, 25, 100];

function acase(i: number, o: Record<string, unknown> = {}) { return { id: 5 + i, clinicId: 1, serviceType: "BrainWave", lifecycleStatus: "active", adminReviewStatus: "approved", globalPlexusPatientId: 900, patientClinicMembershipId: 800, executionCaseId: 70 + i, originatingScreeningId: 77, ...o }; }
function gpp(o: Record<string, unknown> = {}) { return { id: 900, displayName: "J D", dob: "1980-01-01", identityStatus: "active", mergedIntoPatientId: null, ...o }; }
function pcm(o: Record<string, unknown> = {}) { return { id: 800, clinicId: 1, globalPlexusPatientId: 900, membershipStatus: "active", clinicMrn: "MRN-1", ...o }; }
const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));

/** The distinct relations each read model reads exactly once (constant), per N. */
async function totalSelects(run: (calls: Call[]) => Promise<unknown>, spec: Map<unknown, TableSpec>): Promise<number> {
  return runWithDb(spec, CHAIN, async (calls: Call[]) => { await run(calls); return countOps(calls, "select"); });
}

// ── Stage vector ──
async function stageSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>) {
  return new Map<unknown, TableSpec>([
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }],
    [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }],
    [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.canonicalClaims, { select: () => [] }], [t.canonicalInvoices, { select: () => [] }],
    [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
    [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
    [t.ancillaryCases, { select: () => [] }],
  ]);
}
async function testStageVectorBounded() {
  const t = await loadCanonicalTables(); const { buildStageVectors } = await stageMod();
  const counts: number[] = [];
  for (const n of N_MATRIX) {
    counts.push(await totalSelects(async () => buildStageVectors({ clinicId: 1, cases: many(n, (i) => acase(i)) as never }), await stageSpec(t)));
  }
  assert.equal(counts[0], counts[2], `stage vector: SELECTs constant across 1/25/100 (got ${counts.join("/")}) — no per-case N+1`);
  assert.equal(counts[1], counts[2], "stage vector: 25 == 100");
  assert.ok(counts[2] <= 30, `stage vector: bounded relation count (${counts[2]} <= 30)`);
}

// ── Financial view (N claims + N invoices in a page) ──
async function testFinancialViewBounded() {
  const t = await loadCanonicalTables(); const { getCanonicalFinancialView } = await viewMod();
  const claim = (i: number) => ({ id: 700 + i, clinicId: 1, ancillaryCaseId: 5 + i, serviceType: "BrainWave", canonicalStatus: "ready", supersededAt: null, attemptNumber: 1, evidenceFingerprint: "fp", billingDocumentId: 600, billingReadinessCheckId: 500, globalPlexusPatientId: 900, patientClinicMembershipId: 800, currency: "USD", chargeAmount: "1.00", lineItems: [], updatedAt: OLD });
  const invoice = (i: number) => ({ id: 800 + i, clinicId: 1, ancillaryCaseId: 5 + i, serviceType: "BrainWave", claimId: 700 + i, canonicalStatus: "issued", currency: "USD", totalAmount: "1.00", supersededAt: null, evidenceFingerprint: "fp", invoiceType: "patient", recipientType: "patient_membership", recipientId: "M", invoiceNumber: "INV", issuedAt: OLD });
  const counts: number[] = [];
  for (const n of N_MATRIX) {
    const spec = new Map<unknown, TableSpec>([
      [t.canonicalClaims, { select: () => many(n, claim) }], [t.canonicalInvoices, { select: () => many(n, invoice) }],
      [t.canonicalPayments, { select: () => [] }], [t.canonicalPaymentAllocations, { select: () => [] }],
      [t.ancillaryCases, { select: () => [] }], [t.memberships, { select: () => [pcm()] }], [t.globalPatients, { select: () => [gpp()] }],
      [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    ]);
    counts.push(await totalSelects(async () => getCanonicalFinancialView({ clinicId: 1, limit: 200 }), spec));
  }
  assert.equal(counts[0], counts[2], `financial view: SELECTs constant across 1/25/100 (got ${counts.join("/")}) — no per-claim/invoice N+1`);
  assert.ok(counts[2] <= 20, `financial view: bounded (${counts[2]} <= 20)`);
}

// ── PCS / ACS / Clinician Portal (N cases) ──
function readModelSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, n: number) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => many(n, (i) => acase(i)) }],
    [t.adminReviewEvents, { select: () => [] }], [t.engagementLists, { select: () => [] }], [t.engagementMemberships, { select: () => [] }],
    [t.gse, { select: () => [] }], [t.documentReferences, { select: () => [] }], [t.procedureNotes, { select: () => [] }],
    [t.caseDocumentReadiness, { select: () => [] }], [t.procedureEvents, { select: () => [] }],
    [t.billingReadinessChecks, { select: () => [] }], [t.billingDocumentRequests, { select: () => [] }],
    [t.globalPatients, { select: () => [gpp()] }], [t.memberships, { select: () => [pcm()] }],
  ]);
}
async function testReadModelsBounded() {
  const t = await loadCanonicalTables();
  const pcs = await pcsMod(); const acs = await acsMod(); const portal = await portalMod();
  for (const [label, run] of [
    ["PCS", (c: Call[]) => pcs.getPcsCanonicalView({ clinicId: 1, limit: 200 } as never).then(() => void c)],
    ["ACS", (c: Call[]) => acs.getAcsCanonicalView({ clinicId: 1 } as never).then(() => void c)],
    ["ClinicianPortal", (c: Call[]) => portal.getClinicianPortalCanonicalOverview({ clinicId: 1 } as never).then(() => void c)],
  ] as [string, (c: Call[]) => Promise<void>][]) {
    const counts: number[] = [];
    for (const n of N_MATRIX) counts.push(await totalSelects(run, readModelSpec(t, n)));
    assert.equal(counts[0], counts[2], `${label}: SELECTs constant across 1/25/100 (got ${counts.join("/")}) — no per-case N+1`);
    assert.ok(counts[2] <= 30, `${label}: bounded (${counts[2]} <= 30)`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["stage vector: SELECTs constant at 1/25/100", testStageVectorBounded],
  ["financial view: SELECTs constant at 1/25/100", testFinancialViewBounded],
  ["PCS/ACS/ClinicianPortal: SELECTs constant at 1/25/100", testReadModelsBounded],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
