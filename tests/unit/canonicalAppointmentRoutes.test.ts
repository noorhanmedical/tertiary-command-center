// Phase 2D-B — canonical appointment route + orchestrator integration.
//
// HTTP integration for the transition surface, flag-OFF legacy create,
// the controlled-503 path, and the doctor_visit general fallback — via
// a minimal Express app over the real registered routes + fake db.
// Create/reuse/cross-clinic/service-mismatch/projection/retry/flag-OFF
// behaviors are exercised at the orchestrator layer where full HTTP
// faking is impractical.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentRoutes.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildFakeDb,
  loadCanonicalTables,
  countOps,
  type TableSpec,
  type Call,
} from "../support/canonicalHarness";

const START = new Date("2026-05-01T10:00:00Z");
const orch = () => import("../../server/services/canonicalAppointments/scheduleAncillaryOrchestrator");
const proj = () => import("../../server/services/canonicalAppointments/legacyProjection");
const canonSvc = () => import("../../server/services/canonicalAppointments/canonicalAppointmentService");

// ─── HTTP harness ────────────────────────────────────────────────
async function withHttp<T>(
  spec: Map<unknown, TableSpec>,
  flags: { canonicalAppointment?: boolean; ancillaryCaseWrite?: boolean; plexusIdentityWrite?: boolean },
  session: { userId?: string; clinicId?: number | null },
  fn: (baseUrl: string, calls: Call[]) => Promise<T>,
): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const routes = await import("../../server/routes/globalSchedule");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = { ...session };
    (req as unknown as { clinicId: number | null }).clinicId = session.clinicId ?? null;
    next();
  });
  routes.registerGlobalScheduleRoutes(app);
  const httpServer = createServer(app);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const savedFlags = { canonicalAppointment: ff.canonicalAppointment, ancillaryCaseWrite: ff.ancillaryCaseWrite, plexusIdentityWrite: ff.plexusIdentityWrite };
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedDb)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  if (flags.canonicalAppointment !== undefined) ff.canonicalAppointment = flags.canonicalAppointment;
  if (flags.ancillaryCaseWrite !== undefined) ff.ancillaryCaseWrite = flags.ancillaryCaseWrite;
  if (flags.plexusIdentityWrite !== undefined) ff.plexusIdentityWrite = flags.plexusIdentityWrite;
  try {
    return await fn(baseUrl, calls);
  } finally {
    for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v;
    ff.canonicalAppointment = savedFlags.canonicalAppointment;
    ff.ancillaryCaseWrite = savedFlags.ancillaryCaseWrite;
    ff.plexusIdentityWrite = savedFlags.plexusIdentityWrite;
    await new Promise<void>((r) => httpServer.close(() => r()));
  }
}

function canonicalEvent(over: Record<string, unknown> = {}) {
  return {
    id: 555, clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment",
    serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900,
    patientName: null, patientDob: null, facilityId: "FAC1", startsAt: START, endsAt: null,
    parentEventId: null, ...over,
  };
}
async function post(baseUrl: string, path: string, body: unknown) {
  const resp = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: resp.status, json: (await resp.json()) as Record<string, unknown> };
}

// ─── (1) Flag OFF preserves legacy ancillary creation response ────
async function testFlagOffLegacyCreate() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [{ id: 900, clinicId: 1, patientScreeningId: 77, patientName: "P", patientDob: null, facilityId: "FAC1" }], onUpdate: (v) => [{ id: 900, ...v }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 700 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: false }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    const r = await post(baseUrl, "/api/global-schedule-events/schedule-ancillary", {
      executionCaseId: 900, serviceType: "EchoWave", startsAt: START.toISOString(),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal((r.json.event as { id: number }).id, 700);
    assert.ok(!("canonical" in r.json) || r.json.canonical !== true, "flag OFF must not use canonical path");
    assert.equal(countOps(calls, "insert", t.gse), 1, "legacy upsert inserts the event");
  });
}

// ─── (4) doctor_visit remains on the general (legacy) path ────────
async function testDoctorVisitStaysGeneral() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => [canonicalEvent({ eventType: "doctor_visit", ancillaryCaseId: null })], onUpdate: (v) => [canonicalEvent({ eventType: "doctor_visit", status: (v.status as string) })] }],
    [t.executionCases, { onUpdate: () => [] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "cancel" });
    assert.equal(r.status, 200);
    // Legacy transition result carries fromStatus/toStatus, NOT the
    // canonical newEventId/priorEventId body.
    assert.ok("fromStatus" in r.json || "toStatus" in r.json, "doctor_visit must use the legacy transition writer");
    assert.ok(!("newEventId" in r.json), "doctor_visit must not go through canonical reschedule shape");
  });
}

// ─── (7) Cancel without reason → 400 ─────────────────────────────
async function testCancelNoReason() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([[t.gse, { select: () => [canonicalEvent()] }]]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "cancel" });
    assert.equal(r.status, 400);
    assert.equal(countOps(calls, "update", t.gse), 0, "no state change without a reason");
  });
}

// ─── (8) Cancel with reason → 200 ────────────────────────────────
async function testCancelWithReason() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => [canonicalEvent()], onUpdate: (v) => [canonicalEvent({ status: "cancelled", ...v })] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.ancillaryAppointments, { onUpdate: () => [] }],
    [t.screenings, { onUpdate: () => [] }],
    [t.executionCases, { onUpdate: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "cancel", reason: "patient request" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.newStatus, "cancelled");
  });
}

// ─── (9) No-show without reason → 400 ────────────────────────────
async function testNoShowNoReason() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([[t.gse, { select: () => [canonicalEvent()] }]]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "no_show" });
    assert.equal(r.status, 400);
  });
}

// ─── (10) No-show with reason → 200 ──────────────────────────────
async function testNoShowWithReason() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => [canonicalEvent()], onUpdate: (v) => [canonicalEvent({ status: "no_show", ...v })] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.ancillaryAppointments, { onUpdate: () => [] }],
    [t.screenings, { onUpdate: () => [] }],
    [t.executionCases, { onUpdate: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "no_show", reason: "did not appear" });
    assert.equal(r.status, 200);
    assert.equal(r.json.newStatus, "no_show");
  });
}

// ─── (11) Complete scheduled event → 200 ─────────────────────────
async function testComplete() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => [canonicalEvent()], onUpdate: (v) => [canonicalEvent({ status: "completed", ...v })] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.ancillaryAppointments, { onUpdate: () => [] }],
    [t.screenings, { onUpdate: () => [] }],
    [t.executionCases, { onUpdate: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "complete" });
    assert.equal(r.status, 200);
    assert.equal(r.json.newStatus, "completed");
  });
}

// ─── (12/19) Invalid transition → controlled 409; no legacy fallback ─
async function testInvalidTransition() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => [canonicalEvent({ status: "completed" })], onUpdate: (v) => [canonicalEvent({ ...v })] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "cancel", reason: "x" });
    assert.equal(r.status, 409, "invalid canonical transition returns controlled conflict");
    assert.equal(countOps(calls, "update", t.gse), 0, "no unrestricted legacy fallback mutated state");
  });
}

// ─── (13/14) Reschedule returns prior+new ids; new.parentEventId=prior ─
async function testReschedule() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, {
      select: () => [canonicalEvent()],
      onUpdate: (v) => [canonicalEvent({ status: "rescheduled", ...v })],
      onInsert: (v) => [{ ...v, id: 601 }],
    }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.ancillaryAppointments, { onUpdate: () => [] }],
    [t.screenings, { onUpdate: () => [] }],
    [t.executionCases, { onUpdate: () => [] }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", {
      transition: "reschedule", newStartsAt: new Date("2026-06-01T09:00:00Z").toISOString(),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.priorEventId, 555);
    assert.equal(r.json.newEventId, 601);
    assert.equal(r.json.parentEventId, 555, "new event references the prior event");
  });
}

// ─── (18) Missing migration with flag ON → controlled 503 ─────────
async function testMissingMigration503() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, {
      select: () => {
        const e = new Error('column "ancillary_case_id" does not exist') as Error & { code?: string };
        e.code = "42703";
        throw e;
      },
    }],
  ]);
  await withHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl) => {
    const r = await post(baseUrl, "/api/global-schedule-events/555/transition", { transition: "cancel", reason: "x" });
    assert.equal(r.status, 503, "missing migration under flag ON returns controlled 503");
    assert.equal(r.json.code, "CANONICAL_APPOINTMENT_MIGRATION_MISSING");
  });
}

// ─── Orchestrator-layer behaviors ────────────────────────────────

// (2) Flag ON creates canonical ancillary appointment.
// (3) Duplicate creation returns existing canonical event.
function orchestratorSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    [t.screenings, { select: () => [{ id: 77, clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20, name: "x", dob: null, facility: "FAC1" }] }],
    [t.clinics, { select: () => [{ id: 1 }] }],
    [t.globalPatients, { select: () => [{ id: 10 }] }],
    [t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] }],
    [t.executionCases, { select: () => [{ id: 900, clinicId: 1 }] }],
    [t.ancillaryCases, { select: () => [{ id: 300, clinicId: 1, serviceType: "EchoWave", originatingScreeningId: 77, executionCaseId: 900, episodeSequence: 1, lifecycleStatus: "active", patientClinicMembershipId: 20 }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 800 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.carf, {}],
    [t.ancillaryAppointments, {}],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}

async function testOrchestratorCreates() {
  const t = await loadCanonicalTables();
  const o = await orch();
  const { runWithDb } = await import("../support/canonicalHarness");
  const res = await runWithDb(orchestratorSpec(t), { canonicalAppointment: true, ancillaryCaseWrite: true }, async () =>
    o.scheduleCanonicalAncillaryAppointment({
      clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", startsAt: START, source: "test",
    }),
  );
  assert.ok(res.status === "created" || res.status === "reused");
  if (res.status === "created" || res.status === "reused") {
    assert.equal(res.globalScheduleEventId, 800);
    assert.equal(res.ancillaryCaseId, 300);
  }
}

async function testOrchestratorReuse() {
  const t = await loadCanonicalTables();
  const o = await orch();
  const { runWithDb, countOps: cnt } = await import("../support/canonicalHarness");
  const spec = orchestratorSpec(t, {
    gse: { select: () => [{ id: 808, ancillaryCaseId: 300, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled" }], onInsert: (v) => [{ ...v, id: 809 }] },
  });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await o.scheduleCanonicalAncillaryAppointment({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", startsAt: START, source: "test" });
    assert.equal(cnt(calls, "insert", t.gse), 0, "reuse must not insert");
    return r;
  });
  assert.equal(res.status, "reused");
}

// (5) Cross-clinic ancillaryCaseId denied.
async function testCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const c = await canonSvc();
  const { runWithDb } = await import("../support/canonicalHarness");
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 300, clinicId: 2, serviceType: "EchoWave", originatingScreeningId: null, executionCaseId: null }] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async () =>
    c.createCanonicalAncillaryAppointment({ clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment", startsAt: START, source: "test" }),
  );
  assert.equal(res.status, "cross_clinic_denied");
}

// (6) Wrong serviceType rejected.
async function testServiceMismatch() {
  const t = await loadCanonicalTables();
  const c = await canonSvc();
  const { runWithDb } = await import("../support/canonicalHarness");
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 300, clinicId: 1, serviceType: "EchoWave", originatingScreeningId: null, executionCaseId: null }] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async () =>
    c.createCanonicalAncillaryAppointment({ clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment", serviceType: "SleepWave", startsAt: START, source: "test" }),
  );
  assert.equal(res.status, "service_type_mismatch");
}

// (15) Back-pointer written only for a scheduled canonical event.
async function testBackPointerOnlyOnCanonical() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const { runWithDb, countOps: cnt } = await import("../support/canonicalHarness");
  // doctor_visit event → projection is a no-op (no back-pointer write).
  const specA = new Map<unknown, TableSpec>([[t.ancillaryAppointments, { onUpdate: () => [] }]]);
  await runWithDb(specA, { canonicalAppointment: true }, async (calls) => {
    await p.refreshLegacyAppointmentProjection({ canonicalEvent: canonicalEvent({ eventType: "doctor_visit" }) as never, source: "test" });
    assert.equal(cnt(calls, "update", t.ancillaryAppointments), 0, "doctor_visit writes no back-pointer");
  });
  // canonical scheduled event → back-pointer written.
  const specB = new Map<unknown, TableSpec>([
    [t.ancillaryAppointments, { onUpdate: () => [] }],
    [t.screenings, { onUpdate: () => [] }],
    [t.executionCases, { onUpdate: () => [] }],
  ]);
  await runWithDb(specB, { canonicalAppointment: true }, async (calls) => {
    await p.refreshLegacyAppointmentProjection({ canonicalEvent: canonicalEvent() as never, source: "test" });
    assert.equal(cnt(calls, "update", t.ancillaryAppointments), 1, "canonical event writes the back-pointer");
  });
}

// (16) Projection failure returns partial/deferred + durable retry.
async function testProjectionFailureDeferred() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const { runWithDb, countOps: cnt } = await import("../support/canonicalHarness");
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryAppointments, { onUpdate: () => { throw new Error("projection boom"); } }],
    [t.carf, { onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async (calls) => {
    const r = await p.refreshLegacyAppointmentProjection({ canonicalEvent: canonicalEvent() as never, source: "test" });
    assert.equal(cnt(calls, "insert", t.carf), 1, "projection failure records a durable retry");
    return r;
  });
  assert.equal(res.ok, false);
  if (res.ok === false) assert.equal(res.deferred, true);
}

// (17) Scheduling failure creates durable retry (rethrows, no false success).
async function testSchedulingFailureRetry() {
  const t = await loadCanonicalTables();
  const o = await orch();
  const { runWithDb, countOps: cnt } = await import("../support/canonicalHarness");
  const spec = orchestratorSpec(t, {
    gse: {
      select: () => [],
      onInsert: () => { const e = new Error("insert failed") as Error & { code?: string }; e.code = "08006"; throw e; },
    },
    carf: { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] },
  });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    await assert.rejects(
      o.scheduleCanonicalAncillaryAppointment({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", startsAt: START, source: "test" }),
      "scheduling failure must not be swallowed",
    );
    assert.equal(cnt(calls, "insert", t.carf), 1, "durable retry recorded on scheduling failure");
  });
}

// (20) Feature OFF performs no migration-0052 reads/writes.
async function testFlagOffZeroCanonicalIo() {
  const t = await loadCanonicalTables();
  const o = await orch();
  const { runWithDb, countOps: cnt } = await import("../support/canonicalHarness");
  const spec = new Map<unknown, TableSpec>([
    [t.screenings, { select: () => [{ id: 77, clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20 }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.carf, { onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  await runWithDb(spec, { canonicalAppointment: false }, async (calls) => {
    const r = await o.scheduleCanonicalAncillaryAppointment({ clinicId: 1, executionCaseId: 900, patientScreeningId: 77, serviceType: "EchoWave", startsAt: START, source: "test" });
    assert.equal(r.status, "skipped_flag_off");
    assert.equal(cnt(calls, "insert", t.gse), 0);
    assert.equal(cnt(calls, "insert", t.carf), 0);
    assert.equal(cnt(calls, "select", t.gse), 0);
  });
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) flag OFF preserves legacy ancillary creation", testFlagOffLegacyCreate],
  ["(2) flag ON creates canonical ancillary appointment", testOrchestratorCreates],
  ["(3) duplicate creation returns existing canonical event", testOrchestratorReuse],
  ["(4) doctor_visit remains on the general path", testDoctorVisitStaysGeneral],
  ["(5) cross-clinic ancillary case denied", testCrossClinicDenied],
  ["(6) wrong serviceType rejected", testServiceMismatch],
  ["(7) cancel without reason → 400", testCancelNoReason],
  ["(8) cancel with reason → 200", testCancelWithReason],
  ["(9) no-show without reason → 400", testNoShowNoReason],
  ["(10) no-show with reason → 200", testNoShowWithReason],
  ["(11) complete scheduled event → 200", testComplete],
  ["(12/19) invalid transition → 409, no legacy fallback", testInvalidTransition],
  ["(13/14) reschedule returns prior+new ids, parent linked", testReschedule],
  ["(15) back-pointer written only after canonical success", testBackPointerOnlyOnCanonical],
  ["(16) projection failure returns partial/deferred", testProjectionFailureDeferred],
  ["(17) scheduling failure creates durable retry", testSchedulingFailureRetry],
  ["(18) missing migration with flag ON → 503", testMissingMigration503],
  ["(20) feature OFF performs no migration-0052 reads/writes", testFlagOffZeroCanonicalIo],
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
