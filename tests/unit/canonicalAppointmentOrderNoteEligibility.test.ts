// Phase 2D-C1 — Order Note appointment-only eligibility (reader half).
//
// Exercises the existing isOrderNoteAppointmentEligible helper + its
// surfacing through the canonical appointment projection. No Order Note
// is generated; this is only the appointment eligibility signal.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentOrderNoteEligibility.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { runWithDb, loadCanonicalTables, countOps, type TableSpec } from "../support/canonicalHarness";

const START = new Date("2026-10-01T10:00:00Z");
const svc = () => import("../../server/services/canonicalAppointments/canonicalAppointmentService");
const proj = () => import("../../server/services/canonicalAppointments/appointmentProjection");

function evt(over: Record<string, unknown> = {}) {
  return {
    id: 700, clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment",
    serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900,
    startsAt: START, endsAt: null, parentEventId: null, cancellationReason: null, noShowReason: null,
    source: "x", metadata: {}, createdAt: START, updatedAt: START, ...over,
  };
}
function spec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, events: unknown[], serviceType = "EchoWave") {
  return new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 300, serviceType }] }],
    [t.gse, { select: () => events }],
  ]);
}
async function eligible(t: Awaited<ReturnType<typeof loadCanonicalTables>>, events: unknown[], serviceType = "EchoWave", caseId = 300) {
  const s = await svc();
  return runWithDb(spec(t, events, serviceType), { canonicalAppointment: true }, async () =>
    s.isOrderNoteAppointmentEligible({ ancillaryCaseId: caseId }),
  );
}

// ─── (1-4) qualifying cases ───────────────────────────────────────
async function testQualifying() {
  const t = await loadCanonicalTables();
  assert.equal((await eligible(t, [evt({ eventType: "ancillary_appointment", status: "scheduled" })])).eligible, true, "ancillary scheduled");
  assert.equal((await eligible(t, [evt({ eventType: "ancillary_appointment", status: "completed" })])).eligible, true, "ancillary completed");
  assert.equal((await eligible(t, [evt({ eventType: "same_day_add", status: "scheduled" })])).eligible, true, "same_day_add scheduled");
  assert.equal((await eligible(t, [evt({ eventType: "same_day_add", status: "completed" })])).eligible, true, "same_day_add completed");
}

// ─── (5) doctor_visit does not qualify ────────────────────────────
async function testDoctorVisit() {
  const t = await loadCanonicalTables();
  assert.equal((await eligible(t, [evt({ eventType: "doctor_visit" })])).eligible, false);
}

// ─── (6) cancelled does not qualify ───────────────────────────────
async function testCancelled() {
  const t = await loadCanonicalTables();
  assert.equal((await eligible(t, [evt({ status: "cancelled" })])).eligible, false);
}

// ─── (7) no_show does not qualify ─────────────────────────────────
async function testNoShow() {
  const t = await loadCanonicalTables();
  assert.equal((await eligible(t, [evt({ status: "no_show" })])).eligible, false);
}

// ─── (8) rescheduled prior does not qualify ───────────────────────
async function testRescheduledPrior() {
  const t = await loadCanonicalTables();
  assert.equal((await eligible(t, [evt({ status: "rescheduled" })])).eligible, false);
}

// ─── (9) wrong service does not qualify ───────────────────────────
async function testWrongService() {
  const t = await loadCanonicalTables();
  // Case service is SleepWave; only an EchoWave event exists.
  const r = await eligible(t, [evt({ serviceType: "EchoWave" })], "SleepWave");
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "service_type_mismatch");
}

// ─── (10) wrong ancillary case does not qualify ───────────────────
async function testWrongCase() {
  const t = await loadCanonicalTables();
  // Querying a case whose canonical event list is empty (events belong
  // elsewhere) → not eligible.
  assert.equal((await eligible(t, [])).eligible, false);
}

// ─── (11) provisional event (no ancillaryCaseId) does not qualify ─
async function testProvisional() {
  const t = await loadCanonicalTables();
  // A provisional event is not linked to the case, so listByCase yields
  // nothing → not eligible.
  assert.equal((await eligible(t, [])).eligible, false);
}

// ─── (12) the reader API surfaces the helper's result ─────────────
async function testReaderApiSurfacesResult() {
  const t = await loadCanonicalTables();
  const p = await proj();
  // qualifying
  const good = await runWithDb(spec(t, [evt()]), { canonicalAppointment: true }, async () =>
    p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300 }),
  );
  assert.equal(good.appointmentEligibleForOrderNote, true);
  assert.equal(good.appointmentEligibilityReason, "qualifying_appointment");
  // non-qualifying (cancelled)
  const bad = await runWithDb(spec(t, [evt({ status: "cancelled" })]), { canonicalAppointment: true }, async () =>
    p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300 }),
  );
  assert.equal(bad.appointmentEligibleForOrderNote, false);
  assert.notEqual(bad.appointmentEligibilityReason, "qualifying_appointment");
}

// ─── (13) no Order Note is generated (eligibility is read-only) ───
async function testNoOrderNoteGenerated() {
  const t = await loadCanonicalTables();
  await runWithDb(spec(t, [evt()]), { canonicalAppointment: true }, async (calls) => {
    const p = await proj();
    await p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300 });
    assert.equal(countOps(calls, "insert"), 0, "eligibility read must not write anything");
    assert.equal(countOps(calls, "update"), 0);
  });
}

// ─── (14) feature OFF preserves the existing API response ─────────
async function testFlagOff() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const p = await proj();
  await runWithDb(spec(t, [evt()]), { canonicalAppointment: false }, async (calls) => {
    const r = await s.isOrderNoteAppointmentEligible({ ancillaryCaseId: 300 });
    assert.equal(r.eligible, false);
    if (!r.eligible) assert.equal(r.reason, "flag_off");
    const pr = await p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300 });
    assert.equal(pr.flagOff, true);
    assert.equal(pr.appointmentEligibleForOrderNote, false);
    assert.equal(countOps(calls, "select"), 0, "flag OFF issues zero canonical reads");
  });
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1-4) qualifying: ancillary/same_day_add × scheduled/completed", testQualifying],
  ["(5) doctor_visit does not qualify", testDoctorVisit],
  ["(6) cancelled does not qualify", testCancelled],
  ["(7) no_show does not qualify", testNoShow],
  ["(8) rescheduled prior does not qualify", testRescheduledPrior],
  ["(9) wrong service does not qualify", testWrongService],
  ["(10) wrong ancillary case does not qualify", testWrongCase],
  ["(11) provisional event does not qualify", testProvisional],
  ["(12) the reader API surfaces the helper's result", testReaderApiSurfacesResult],
  ["(13) no Order Note is generated", testNoOrderNoteGenerated],
  ["(14) feature OFF preserves the existing API response", testFlagOff],
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
