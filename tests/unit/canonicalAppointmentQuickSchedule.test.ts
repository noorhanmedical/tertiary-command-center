// Phase 2D-B — quick-schedule deterministic canonical linkage behavior.
//
// Behavioral tests over the shared fake-db harness for
// finalizeQuickScheduleCanonicalLink + Order Note eligibility on
// provisional vs finalized state.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentQuickSchedule.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  runWithDb,
  loadCanonicalTables,
  countOps,
  type TableSpec,
  type Call,
} from "../support/canonicalHarness";

const svc = () => import("../../server/services/canonicalAppointments/quickScheduleLink");
const canonSvc = () => import("../../server/services/canonicalAppointments/canonicalAppointmentService");

const START = new Date("2026-04-01T10:00:00Z");

function execRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 900, clinicId: 1, patientScreeningId: 77,
    selectedServices: ["EchoWave"], facilityId: "FAC1", nextActionAt: START, ...overrides,
  };
}
function screeningRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 77, clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20,
    name: "x", dob: null, facility: "FAC1", ...overrides,
  };
}
function caseRow(id: number, serviceType = "EchoWave") {
  return {
    id, clinicId: 1, serviceType, originatingScreeningId: 77, executionCaseId: 900,
    episodeSequence: 1, lifecycleStatus: "active", patientClinicMembershipId: 20,
    globalPlexusPatientId: 10,
  };
}
function queued(results: unknown[][]): () => unknown[] {
  let i = 0;
  return () => results[Math.min(i++, results.length - 1)];
}

/** Spec builder for the happy identity+integrity path. */
function baseSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [execRow()] }],
    [t.screenings, { select: () => [screeningRow()] }],
    [t.ancillaryFailures, { select: () => [] }],
    [t.clinics, { select: () => [{ id: 1 }] }],
    [t.globalPatients, { select: () => [{ id: 10 }] }],
    [t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] }],
    [t.ancillaryCases, { select: () => [caseRow(300)] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 500 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.carf, {}],
    [t.ancillaryAppointments, {}],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}

// ─── (1) Existing patient quick schedule resolves identity + links ─
async function testExistingPatientLinks() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const res = await runWithDb(baseSpec(t), { canonicalAppointment: true, ancillaryCaseWrite: true }, async () =>
    s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, startsAt: START, source: "test" }),
  );
  assert.equal(res.status, "linked");
  if (res.status === "linked") {
    assert.equal(res.perService.length, 1);
    assert.equal(res.perService[0].status, "linked");
    assert.equal(res.perService[0].globalScheduleEventId, 500);
  }
}

// ─── (2) New patient defers until identity is available ───────────
async function testNewPatientDefers() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    screenings: { select: () => [screeningRow({ globalPlexusPatientId: null, patientClinicMembershipId: null })] },
    carf: { onInsert: (v) => [{ ...v, id: 1 }] },
  });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true, plexusIdentityWrite: false }, async (calls) => {
    const r = await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 0, "no canonical event before identity");
    assert.equal(countOps(calls, "insert", t.carf), 1, "durable retry recorded");
    return r;
  });
  assert.equal(res.status, "deferred");
  if (res.status === "deferred") assert.equal(res.reason, "identity_unavailable");
}

// ─── (3) Multiple services create separate cases + events ─────────
async function testMultipleServices() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    executionCases: { select: () => [execRow({ selectedServices: ["EchoWave", "SleepWave"] })] },
    // reuse path: each service resolves its own case (2 selects per service).
    ancillaryCases: { select: queued([[caseRow(300, "EchoWave")], [caseRow(300, "EchoWave")], [caseRow(301, "SleepWave")], [caseRow(301, "SleepWave")]]) },
    gse: { select: () => [], onInsert: queuedInsert() },
  });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, startsAt: START, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 2, "one canonical event per service");
    return r;
  });
  assert.equal(res.status, "linked");
  if (res.status === "linked") {
    assert.equal(res.perService.length, 2);
    const caseIds = res.perService.map((p) => p.ancillaryCaseId).sort();
    assert.deepEqual(caseIds, [300, 301], "distinct ancillary cases");
  }
}

// ─── (4) Same-service retry reuses existing case + event ──────────
async function testSameServiceReuse() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    // getActive returns an already-scheduled same_day_add event.
    gse: { select: () => [{ id: 555, ancillaryCaseId: 300, eventType: "same_day_add", serviceType: "EchoWave", status: "scheduled" }], onInsert: (v) => [{ ...v, id: 999 }] },
  });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, startsAt: START, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 0, "reuse must not insert a new event");
    return r;
  });
  assert.equal(res.status, "linked");
  if (res.status === "linked") {
    assert.equal(res.perService[0].status, "reused");
    assert.equal(res.perService[0].globalScheduleEventId, 555);
  }
}

// ─── (5) Ambiguous / unavailable identity creates durable retry ───
async function testAmbiguousIdentityRetry() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    screenings: { select: () => [screeningRow({ globalPlexusPatientId: null, patientClinicMembershipId: null })] },
    carf: { onInsert: (v) => [{ ...v, id: 1 }] },
  });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true, plexusIdentityWrite: false }, async (calls) => {
    const r = await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, source: "test" });
    assert.equal(r.status, "deferred");
    assert.equal(countOps(calls, "insert", t.carf), 1, "durable retry row recorded");
  });
}

// ─── (6) Screening / execution-case clinic mismatch refused ───────
async function testClinicMismatch() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, { executionCases: { select: () => [execRow({ clinicId: 2 })] } });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 0);
    return r;
  });
  assert.equal(res.status, "clinic_mismatch");
}

// ─── (7/8) Null-screening Phase 2B retry linked + closed on success ─
async function testPhase2BRetryLinkedAndClosed() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, {
    // execution case has no selectedServices; the requested service
    // comes solely from an open Phase 2B quick-schedule ledger row.
    executionCases: { select: () => [execRow({ selectedServices: [] })] },
    ancillaryFailures: {
      select: () => [{ id: 7, serviceType: "EchoWave", executionCaseId: 900, errorCode: "MISSING_IDENTITY_LINKS_QUICK_SCHEDULE", resolvedAt: null }],
      onUpdate: (v) => [{ ...v }],
    },
  });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, startsAt: START, source: "test" });
    assert.ok(countOps(calls, "update", t.ancillaryFailures) >= 1, "Phase 2B retry row must be resolved");
    return r;
  });
  assert.equal(res.status, "linked");
  if (res.status === "linked") assert.equal(res.perService[0].serviceType, "EchoWave");
}

// ─── (9) Phase 2D retry row closes on success ─────────────────────
async function testPhase2DRetryClosed() {
  const t = await loadCanonicalTables();
  const s = await svc();
  const spec = baseSpec(t, { carf: { onUpdate: (v) => [{ ...v }] } });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, startsAt: START, source: "test" });
    assert.ok(countOps(calls, "update", t.carf) >= 1, "Phase 2D retry row must be resolved");
  });
}

// ─── (10) Repeated retry creates no duplicate events ──────────────
async function testRepeatedRetryNoDuplicate() {
  const t = await loadCanonicalTables();
  const s = await svc();
  // Second run: getActive already returns the scheduled event → reuse.
  const spec = baseSpec(t, {
    gse: { select: () => [{ id: 500, ancillaryCaseId: 300, eventType: "same_day_add", serviceType: "EchoWave", status: "scheduled" }], onInsert: (v) => [{ ...v, id: 501 }] },
  });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    await s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, startsAt: START, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 0, "second finalize reuses, never duplicates");
  });
}

// ─── (11) Provisional (no canonical event) is not appointment-eligible ─
async function testProvisionalNotEligible() {
  const t = await loadCanonicalTables();
  const c = await canonSvc();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 300, serviceType: "EchoWave" }] }],
    [t.gse, { select: () => [] }], // no canonical events → provisional
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async () =>
    c.isOrderNoteAppointmentEligible({ ancillaryCaseId: 300 }),
  );
  assert.equal(res.eligible, false);
}

// ─── (12) Finalized same_day_add becomes appointment-eligible ─────
async function testFinalizedEligible() {
  const t = await loadCanonicalTables();
  const c = await canonSvc();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 300, serviceType: "EchoWave" }] }],
    [t.gse, { select: () => [{ id: 500, ancillaryCaseId: 300, eventType: "same_day_add", serviceType: "EchoWave", status: "scheduled", startsAt: START }] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async () =>
    c.isOrderNoteAppointmentEligible({ ancillaryCaseId: 300 }),
  );
  assert.equal(res.eligible, true);
  if (res.eligible) assert.equal(res.status, "scheduled");
}

// ─── (13) No PHI in retry metadata ────────────────────────────────
async function testNoPhiInRetryMetadata() {
  const t = await loadCanonicalTables();
  const s = await svc();
  let carfPayload: Record<string, unknown> | null = null;
  const spec = baseSpec(t, {
    screenings: { select: () => [screeningRow({ globalPlexusPatientId: null, patientClinicMembershipId: null })] },
    carf: { onInsert: (v) => { carfPayload = v; return [{ ...v, id: 1 }]; } },
  });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true, plexusIdentityWrite: false }, async () =>
    s.finalizeQuickScheduleCanonicalLink({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, source: "test" }),
  );
  assert.ok(carfPayload, "a durable retry row should have been written");
  const blob = JSON.stringify(carfPayload).toLowerCase();
  for (const forbidden of ["patient_name", "\"name\"", "dob", "mrn", "phone", "insurance", "diagnosis", "medication", "reasoning"]) {
    assert.ok(!blob.includes(forbidden), `retry metadata must not contain PHI token: ${forbidden}`);
  }
}

function queuedInsert(): (v: Record<string, unknown>) => unknown[] {
  let n = 500;
  return (v) => [{ ...v, id: n++ }];
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) existing patient quick schedule resolves identity + links", testExistingPatientLinks],
  ["(2) new patient defers until identity available", testNewPatientDefers],
  ["(3) multiple services → separate cases + events", testMultipleServices],
  ["(4) same-service retry reuses case + event", testSameServiceReuse],
  ["(5) ambiguous/unavailable identity creates durable retry", testAmbiguousIdentityRetry],
  ["(6) screening/execution-case clinic mismatch refused", testClinicMismatch],
  ["(7/8) null-screening Phase 2B retry linked + closed", testPhase2BRetryLinkedAndClosed],
  ["(9) Phase 2D retry row closes on success", testPhase2DRetryClosed],
  ["(10) repeated retry creates no duplicate events", testRepeatedRetryNoDuplicate],
  ["(11) provisional has no Order Note eligibility", testProvisionalNotEligible],
  ["(12) finalized same_day_add is appointment-eligible", testFinalizedEligible],
  ["(13) no PHI in retry metadata", testNoPhiInRetryMetadata],
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
