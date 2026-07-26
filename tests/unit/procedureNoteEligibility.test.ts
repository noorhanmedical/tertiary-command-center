// Phase 2F — canonical Procedure Note eligibility (two-condition rule).
//
//   npx tsx tests/unit/procedureNoteEligibility.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const svc = () => import("../../server/services/procedureLifecycle/procedureNoteEligibility");
const COMPLETED_AT = new Date("2027-06-10T09:00:00Z");
const CREATED_AT = new Date("2027-06-01T10:00:00Z");
const FLAGS = { canonicalProcedureNote: true, unifiedAncillaryDocuments: true } as const;

function caseRow(over: Record<string, unknown> = {}) {
  return {
    id: 5, clinicId: 1, serviceType: "BrainWave", adminReviewStatus: "approved",
    originatingScreeningId: 77, executionCaseId: 900, globalPlexusPatientId: 10,
    patientClinicMembershipId: 20, lifecycleStatus: "active", ...over,
  };
}
function peRow(over: Record<string, unknown> = {}) {
  return {
    id: 300, clinicId: 1, ancillaryCaseId: 5, executionCaseId: 900, patientScreeningId: 77,
    globalScheduleEventId: null, serviceType: "BrainWave", procedureStatus: "complete",
    completedByUserId: null, completedAt: COMPLETED_AT, note: null, metadata: {},
    globalPlexusPatientId: null, patientClinicMembershipId: null,
    createdAt: CREATED_AT, updatedAt: CREATED_AT, ...over,
  };
}
function reportRef(over: Record<string, unknown> = {}) {
  return {
    id: 42, clinicId: 1, ancillaryCaseId: 5, documentKind: "report", serviceType: "BrainWave",
    documentStatus: "uploaded", supersededAt: null, sourceTable: "case_document_readiness",
    sourceId: 1000, actualCreatedAt: CREATED_AT, metadata: {}, ...over,
  };
}

function spec(
  t: Awaited<ReturnType<typeof loadCanonicalTables>>,
  o: { pe?: unknown[]; reports?: unknown[]; peThrows?: string } = {},
) {
  const peSelect = o.peThrows
    ? () => { const e = new Error("missing") as Error & { code?: string }; e.code = o.peThrows; throw e; }
    : () => o.pe ?? [peRow()];
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.procedureEvents, { select: peSelect }],
    [t.documentReferences, { select: () => o.reports ?? [reportRef()] }],
  ]);
}

// (1) completed procedure + current exact-case report → eligible
async function testEligible() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.eligible, true);
  assert.equal(r.procedureComplete, true);
  assert.equal(r.reportAssociated, true);
}

// (2) completed procedure without report → ineligible
async function testProcedureNoReport() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { reports: [] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.eligible, false);
  assert.equal(r.procedureComplete, true);
  assert.ok(r.reasons.includes("report_missing"), `reasons: ${r.reasons}`);
}

// (3) report without completed procedure → ineligible
async function testReportNoProcedure() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { pe: [] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.eligible, false);
  assert.equal(r.reportAssociated, true);
  assert.ok(r.reasons.includes("procedure_event_missing"), `reasons: ${r.reasons}`);
}

// (4) another case's report → ineligible (defensive ownership guard)
async function testAnotherCaseReport() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { reports: [reportRef({ ancillaryCaseId: 999 })] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.eligible, false);
  assert.equal(r.reportAssociated, false);
  assert.ok(r.reasons.includes("report_case_mismatch"), `reasons: ${r.reasons}`);
}

// (5) another service's report → ineligible
async function testAnotherServiceReport() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { reports: [reportRef({ serviceType: "EchoWave" })] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("report_service_mismatch"), `reasons: ${r.reasons}`);
}

// (6) superseded/voided report → ineligible
async function testSupersededReport() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const superseded = await runWithDb(spec(t, { reports: [reportRef({ supersededAt: COMPLETED_AT })] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(superseded.eligible, false);
  assert.ok(superseded.reasons.includes("report_not_current"), `reasons: ${superseded.reasons}`);
  const voided = await runWithDb(spec(t, { reports: [reportRef({ documentStatus: "voided" })] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(voided.eligible, false);
  assert.ok(voided.reasons.includes("report_not_current"), `voided reasons: ${voided.reasons}`);
}

// (7) doctor_visit does not count — no procedure_events row is ever created
async function testDoctorVisitNotCount() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { pe: [] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.procedureComplete, false);
  assert.ok(r.reasons.includes("procedure_event_missing"));
}

// (8) scheduled appointment does not count — a not_started procedure event
async function testScheduledNotCount() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { pe: [peRow({ procedureStatus: "not_started", completedAt: null })] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.procedureComplete, false);
  assert.ok(r.reasons.includes("procedure_not_complete"), `reasons: ${r.reasons}`);
}

// (9) cancelled / no_show does not count
async function testCancelledNoShowNotCount() {
  const t = await loadCanonicalTables();
  const s = await svc();
  for (const st of ["cancelled", "no_show"]) {
    const r = await runWithDb(spec(t, { pe: [peRow({ procedureStatus: st, completedAt: null })] }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
    assert.equal(r.procedureComplete, false, `${st} is not a completion`);
    assert.ok(r.reasons.includes("procedure_not_complete"));
  }
}

// (10) exact procedure event / reference IDs are returned
async function testExactIds() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.qualifyingProcedureEventId, 300);
  assert.equal(r.qualifyingReportReferenceId, 42);
  assert.equal(r.reportSourceTable, "case_document_readiness");
  assert.equal(r.reportSourceId, 1000);
}

// (11) cross-clinic access denied
async function testCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t), FLAGS, async (calls: Call[]) => {
    const res = await s.evaluateProcedureNoteEligibility({ clinicId: 2, ancillaryCaseId: 5 });
    // Only the case read happens; no procedure/report reads on a denied clinic.
    assert.equal(countOps(calls, "select", t.procedureEvents), 0, "no procedure read after cross-clinic deny");
    return res;
  });
  assert.equal(r.clinicMismatch, true);
  assert.ok(r.reasons.includes("cross_clinic_denied"));
}

// (12) feature OFF → zero reads/writes
async function testFlagOffZeroIo() {
  const t = await loadCanonicalTables();
  const s = await svc();
  await runWithDb(spec(t), { canonicalProcedureNote: false }, async (calls: Call[]) => {
    const r = await s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 });
    assert.equal(r.flagOff, true);
    assert.equal(calls.length, 0, "flag OFF issues zero reads/writes");
  });
}

// (20) actual procedure/report timestamps preserved; eligibility never writes
async function testTimestampsPreservedReadOnly() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t), FLAGS, async (calls: Call[]) => {
    const res = await s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 });
    assert.equal(countOps(calls, "insert"), 0, "eligibility never inserts");
    assert.equal(countOps(calls, "update"), 0, "eligibility never updates");
    return res;
  });
  assert.equal((r.procedureCompletedAt as Date).getTime(), COMPLETED_AT.getTime(), "actual completion instant preserved, never backdated");
}

// (bonus) missing migration column → truthful migration_missing
async function testMigrationMissing() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { peThrows: "42703" }), FLAGS, async () => s.evaluateProcedureNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }));
  assert.equal(r.migrationMissing, true);
  assert.ok(r.reasons.includes("migration_missing"));
  assert.equal(r.eligible, false);
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) completed procedure + current exact-case report → eligible", testEligible],
  ["(2) completed procedure without report → ineligible", testProcedureNoReport],
  ["(3) report without completed procedure → ineligible", testReportNoProcedure],
  ["(4) another case's report → ineligible", testAnotherCaseReport],
  ["(5) another service's report → ineligible", testAnotherServiceReport],
  ["(6) superseded/voided report → ineligible", testSupersededReport],
  ["(7) doctor_visit does not count", testDoctorVisitNotCount],
  ["(8) scheduled appointment does not count", testScheduledNotCount],
  ["(9) cancelled/no_show does not count", testCancelledNoShowNotCount],
  ["(10) exact procedure event/reference IDs returned", testExactIds],
  ["(11) cross-clinic access denied", testCrossClinicDenied],
  ["(12) feature OFF → zero reads/writes", testFlagOffZeroIo],
  ["(20) actual timestamps preserved; read-only", testTimestampsPreservedReadOnly],
  ["(bonus) migration missing → truthful migration_missing", testMigrationMissing],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok  ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); }
  }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}

run();
