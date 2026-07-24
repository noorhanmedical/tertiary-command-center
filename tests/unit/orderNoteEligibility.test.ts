// Phase 2E-A — Order Note eligibility (two-condition contract).
//
//   npx tsx tests/unit/orderNoteEligibility.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, type TableSpec } from "../support/canonicalHarness";

const svc = () => import("../../server/services/ancillaryDocuments/orderNoteEligibility");
const START = new Date("2027-05-01T10:00:00Z");

function caseRow(over: Record<string, unknown> = {}) {
  return { id: 5, clinicId: 1, serviceType: "EchoWave", adminReviewStatus: "approved", originatingScreeningId: 77, executionCaseId: 900, ...over };
}
function evt(over: Record<string, unknown> = {}) {
  return { id: 700, clinicId: 1, ancillaryCaseId: 5, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START, endsAt: null, parentEventId: null, cancellationReason: null, noShowReason: null, source: "x", metadata: {}, createdAt: START, updatedAt: START, ...over };
}
function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, gse: TableSpec, cases: unknown[] = [caseRow()]) {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => cases }],
    [t.gse, gse],
  ]);
}
async function evaluate(t: Awaited<ReturnType<typeof loadCanonicalTables>>, gse: TableSpec, cases?: unknown[]) {
  const s = await svc();
  return runWithDb(spec(t, gse, cases), { canonicalOrderNote: true, canonicalAppointment: true }, async () =>
    s.evaluateOrderNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }),
  );
}
function queued(results: unknown[][]): () => unknown[] { let i = 0; return () => results[Math.min(i++, results.length - 1)]; }

// ─── qualifying ───────────────────────────────────────────────────
async function testApprovedScheduled() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt({ status: "scheduled" })] });
  assert.equal(r.eligible, true);
  assert.equal(r.adminReviewEligible, true);
  assert.equal(r.appointmentEligible, true);
  assert.equal(r.qualifyingAppointmentId, 700);
}
async function testApprovedCompleted() {
  const t = await loadCanonicalTables();
  assert.equal((await evaluate(t, { select: () => [evt({ status: "completed" })] })).eligible, true);
}
async function testApprovedSameDayAdd() {
  const t = await loadCanonicalTables();
  assert.equal((await evaluate(t, { select: () => [evt({ eventType: "same_day_add", status: "scheduled" })] })).eligible, true);
}

// ─── admin review blockers ────────────────────────────────────────
async function testPending() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt()] }, [caseRow({ adminReviewStatus: "pending" })]);
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("admin_review_pending"));
}
async function testRejected() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt()] }, [caseRow({ adminReviewStatus: "rejected" })]);
  assert.ok(r.reasons.includes("admin_review_rejected"));
}
async function testNeedsInfo() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt()] }, [caseRow({ adminReviewStatus: "needs_info" })]);
  assert.ok(r.reasons.includes("admin_review_needs_info"));
}

// ─── appointment blockers ─────────────────────────────────────────
async function testDoctorVisit() {
  const t = await loadCanonicalTables();
  // listByCase (x2) empty; then the doctor_visit probe returns one.
  const r = await evaluate(t, { select: queued([[], [], [evt({ eventType: "doctor_visit" })]]) });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("doctor_visit_not_eligible"), `reasons=${r.reasons}`);
}
async function testCancelled() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt({ status: "cancelled" })] });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("appointment_cancelled"));
}
async function testNoShow() {
  const t = await loadCanonicalTables();
  assert.ok((await evaluate(t, { select: () => [evt({ status: "no_show" })] })).reasons.includes("appointment_no_show"));
}
async function testRescheduled() {
  const t = await loadCanonicalTables();
  assert.ok((await evaluate(t, { select: () => [evt({ status: "rescheduled" })] })).reasons.includes("appointment_rescheduled"));
}
async function testWrongService() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt({ serviceType: "SleepWave" })] });
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("appointment_service_mismatch"), `reasons=${r.reasons}`);
}
async function testWrongCase() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [] }, []); // case not found
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("ancillary_case_not_found"));
}

// ─── same-day ─────────────────────────────────────────────────────
async function testSameDayPendingReview() {
  const t = await loadCanonicalTables();
  // same_day_add scheduled BUT admin review pending → NOT eligible.
  const r = await evaluate(t, { select: () => [evt({ eventType: "same_day_add" })] }, [caseRow({ adminReviewStatus: "pending" })]);
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.includes("admin_review_pending"));
}
async function testSameDayApproved() {
  const t = await loadCanonicalTables();
  const r = await evaluate(t, { select: () => [evt({ eventType: "same_day_add" })] }, [caseRow({ adminReviewStatus: "approved" })]);
  assert.equal(r.eligible, true);
}

// ─── docs are warnings, not blockers ──────────────────────────────
async function testMissingDocsNotBlockers() {
  const t = await loadCanonicalTables();
  // Approved + scheduled, no report/consent/screening documents at all.
  const r = await evaluate(t, { select: () => [evt()] });
  assert.equal(r.eligible, true, "missing optional documents must NOT block Order Note eligibility");
  for (const docBlocker of ["report_missing", "consent_missing", "screening_form_missing", "report", "consent"]) {
    assert.ok(!r.reasons.includes(docBlocker), `missing docs must not be a blocker reason: ${docBlocker}`);
  }
}
async function testConsentDoesNotChangeContract() {
  const t = await loadCanonicalTables();
  // Eligibility is exactly admin_review + appointment; consent absence
  // does not flip the two-condition result.
  const r = await evaluate(t, { select: () => [evt()] });
  assert.equal(r.eligible, r.adminReviewEligible && r.appointmentEligible);
}

// ─── flag off ─────────────────────────────────────────────────────
async function testFlagOff() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const r = await runWithDb(spec(t, { select: () => [evt()] }), { canonicalOrderNote: false, canonicalAppointment: true }, async () =>
    s.evaluateOrderNoteEligibility({ clinicId: 1, ancillaryCaseId: 5 }),
  );
  assert.equal(r.eligible, false);
  assert.equal(r.flagOff, true);
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) approved + scheduled qualifies", testApprovedScheduled],
  ["(2) approved + completed qualifies", testApprovedCompleted],
  ["(3) approved + same_day_add qualifies", testApprovedSameDayAdd],
  ["(4) pending Admin Review does not qualify", testPending],
  ["(5) rejected does not qualify", testRejected],
  ["(6) needs_info does not qualify", testNeedsInfo],
  ["(7) doctor_visit does not qualify", testDoctorVisit],
  ["(8) cancelled does not qualify", testCancelled],
  ["(9) no_show does not qualify", testNoShow],
  ["(10) rescheduled prior does not qualify", testRescheduled],
  ["(11) wrong service does not qualify", testWrongService],
  ["(12) wrong ancillary case does not qualify", testWrongCase],
  ["(13) same-day pending review does not qualify", testSameDayPendingReview],
  ["(14) same-day approved becomes eligible", testSameDayApproved],
  ["(15) missing optional docs are warnings, not blockers", testMissingDocsNotBlockers],
  ["(16) consent does not change the two-condition contract", testConsentDoesNotChangeContract],
  ["(17) flag OFF → not eligible, flagOff", testFlagOff],
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
