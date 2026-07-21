// Phase 2D-B3 — call-result scheduling writer behavior (HTTP).
//
// Exercises the Engagement Center + Plexus Task call-outcome routes over
// a real in-memory Express app with a fake DB + patched storage, proving
// the orchestration is invoked and the serialized 200/202/409/503
// statuses are truthful.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentCallResultWriters.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildFakeDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const REPO_ROOT = process.cwd();
const START = new Date("2026-09-01T10:00:00Z");

// ─── Harness: register both call-result routes over fake db/storage ──
type StorageOverrides = Record<string, (...args: unknown[]) => unknown>;
async function withCallResultHttp<T>(opts: {
  spec: Map<unknown, TableSpec>;
  flags: { canonicalAppointment?: boolean };
  session: { userId?: string; role?: string; clinicId?: number | null };
  storage?: StorageOverrides;
  fn: (baseUrl: string, calls: Call[], spies: { apptStatusWrites: unknown[] }) => Promise<T>;
}): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const storageMod = await import("../../server/storage");
  const execRoutes = await import("../../server/routes/executionCases");
  const plexusRoutes = await import("../../server/routes/plexusTasks");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const storage = storageMod.storage as unknown as Record<string, unknown>;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = { ...opts.session };
    (req as unknown as { clinicId: number | null }).clinicId = opts.session.clinicId ?? null;
    next();
  });
  execRoutes.registerExecutionCaseRoutes(app);
  plexusRoutes.registerPlexusTasksRoutes(app);
  const httpServer = createServer(app);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const savedFlag = ff.canonicalAppointment;
  const apptStatusWrites: unknown[] = [];
  // Default storage stubs used by the plexus route; overridable.
  const defaultStorage: StorageOverrides = {
    updatePatientScreening: (_id: unknown, patch: unknown) => { apptStatusWrites.push(patch); return Promise.resolve({}); },
    writeEvent: () => Promise.resolve(),
    getCollaborators: () => Promise.resolve([]),
  };
  const overrides = { ...defaultStorage, ...(opts.storage ?? {}) };
  const savedStorage: Record<string, unknown> = {};
  for (const k of Object.keys(overrides)) { savedStorage[k] = storage[k]; storage[k] = overrides[k]; }

  const { db: fake, calls } = buildFakeDb(opts.spec);
  for (const k of Object.keys(savedDb)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  if (opts.flags.canonicalAppointment !== undefined) ff.canonicalAppointment = opts.flags.canonicalAppointment;
  try {
    return await opts.fn(baseUrl, calls, { apptStatusWrites });
  } finally {
    for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v;
    for (const [k, v] of Object.entries(savedStorage)) storage[k] = v;
    ff.canonicalAppointment = savedFlag;
    await new Promise<void>((r) => httpServer.close(() => r()));
  }
}

async function post(baseUrl: string, path: string, body: unknown) {
  const resp = await fetch(baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let json: Record<string, unknown> = {};
  try { json = (await resp.json()) as Record<string, unknown>; } catch { /* */ }
  return { status: resp.status, json };
}

const ec = () => ({ id: 900, clinicId: 1, patientScreeningId: 77, patientName: "P", patientDob: null, facilityId: "F" });
function canonEvent(over: Record<string, unknown> = {}) {
  return { id: 555, clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, patientName: null, patientDob: null, facilityId: "F", startsAt: START, endsAt: null, parentEventId: null, ...over };
}
function engagementSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, gse?: TableSpec): Map<unknown, TableSpec> {
  return new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [ec()], onUpdate: () => [ec()] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.ancillaryAppointments, { select: () => [], onUpdate: () => [] }],
    [t.screenings, { onUpdate: () => [] }],
    [t.carf, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    ...(gse ? [[t.gse, gse] as [unknown, TableSpec]] : []),
  ]);
}

// ─── (1) Engagement flag OFF preserves legacy behavior ────────────
async function testEngagementFlagOffLegacy() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: engagementSpec(t),
    flags: { canonicalAppointment: false },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl, calls) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "declined" });
      assert.equal(r.status, 200);
      assert.equal(countOps(calls, "insert", t.gse), 0, "no canonical event write under flag OFF");
      assert.equal(countOps(calls, "update", t.gse), 0);
    },
  });
}

// ─── (2) Engagement flag ON invokes orchestration for scheduling ──
async function testEngagementFlagOnCancel() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: engagementSpec(t, { select: () => [canonEvent()], onUpdate: (v) => [canonEvent({ ...v, status: "cancelled" })] }),
    flags: { canonicalAppointment: true },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl, calls) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "cancelled", globalScheduleEventId: 555, cancelReason: "patient request" });
      assert.equal(r.status, 200);
      assert.equal((r.json.scheduling as { status: string }).status, "cancelled");
      assert.ok(countOps(calls, "update", t.gse) >= 1, "canonical transition executed");
    },
  });
}

// ─── (3) Engagement non-scheduling outcome → no canonical write ───
async function testEngagementNonSchedulingNoCanonical() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: engagementSpec(t, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }),
    flags: { canonicalAppointment: true },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl, calls) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "callback" });
      assert.equal(r.status, 200);
      assert.equal(countOps(calls, "insert", t.gse), 0, "no canonical appointment for a non-scheduling outcome");
      assert.equal(countOps(calls, "update", t.gse), 0);
    },
  });
}

// ─── (4/5/6) Deferred scheduling → 202, not scheduled, call kept ──
async function testEngagementDeferred() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: engagementSpec(t, { select: () => [canonEvent()], onUpdate: () => { const e = new Error("boom") as Error & { code?: string }; e.code = "08006"; throw e; } }),
    flags: { canonicalAppointment: true },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl, calls) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "no_show", globalScheduleEventId: 555, noShowReason: "did not appear" });
      assert.equal(r.status, 202, "deferred scheduling returns 202");
      assert.equal(r.json.retryPending, true);
      assert.equal((r.json.scheduling as { status: string }).status, "deferred");
      // (5) must not mark the appointment scheduled → projection never ran.
      assert.equal(countOps(calls, "update", t.screenings), 0, "no false scheduled projection");
      // (6) call record persisted (audit journey row written) + durable retry.
      assert.ok(countOps(calls, "insert", t.journeyEvents) >= 1, "call outcome audit persisted");
      assert.ok(countOps(calls, "insert", t.carf) >= 1, "durable retry recorded");
    },
  });
}

// ─── (7) Plexus flag OFF preserves legacy behavior ────────────────
async function testPlexusFlagOffLegacy() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: new Map(),
    flags: { canonicalAppointment: false },
    session: { userId: "admin-user", role: "admin", clinicId: 1 },
    storage: {
      getTaskById: () => Promise.resolve({ id: 5, patientScreeningId: 77, status: "open", createdByUserId: "admin-user" }),
      updateTask: (_id: unknown, patch: unknown) => Promise.resolve({ id: 5, ...(patch as object) }),
    },
    fn: async (baseUrl, _calls, spies) => {
      const r = await post(baseUrl, "/api/plexus/tasks/5/call-outcome", { outcome: "scheduled", appointmentStatus: "scheduled" });
      assert.equal(r.status, 200);
      assert.equal(spies.apptStatusWrites.length, 1, "legacy path writes appointmentStatus directly");
    },
  });
}

// ─── (8) Plexus flag ON scheduling-state outcome → orchestration ──
async function testPlexusFlagOnCancel() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: new Map<unknown, TableSpec>([
      [t.gse, { select: () => [canonEvent()], onUpdate: (v) => [canonEvent({ ...v, status: "cancelled" })] }],
      [t.journeyEvents, { onInsert: () => [] }],
      [t.ancillaryAppointments, { select: () => [], onUpdate: () => [] }],
      [t.screenings, { onUpdate: () => [] }],
      [t.carf, {}],
    ]),
    flags: { canonicalAppointment: true },
    session: { userId: "admin-user", role: "admin", clinicId: 1 },
    storage: {
      getTaskById: () => Promise.resolve({ id: 5, patientScreeningId: 77, status: "open", createdByUserId: "admin-user" }),
      updateTask: (_id: unknown, patch: unknown) => Promise.resolve({ id: 5, ...(patch as object) }),
    },
    fn: async (baseUrl, calls, spies) => {
      const r = await post(baseUrl, "/api/plexus/tasks/5/call-outcome", { outcome: "scheduled", schedulingAction: "cancel", globalScheduleEventId: 555, reason: "patient request" });
      assert.equal(r.status, 200);
      assert.equal((r.json.scheduling as { status: string }).status, "cancelled");
      assert.ok(countOps(calls, "update", t.gse) >= 1, "canonical transition executed");
      assert.equal(spies.apptStatusWrites.length, 0, "must NOT directly write appointmentStatus under canonical mode");
    },
  });
}

// ─── (9) Plexus non-scheduling outcome → no canonical write ───────
async function testPlexusNonSchedulingNoCanonical() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: new Map<unknown, TableSpec>([[t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }]]),
    flags: { canonicalAppointment: true },
    session: { userId: "admin-user", role: "admin", clinicId: 1 },
    storage: {
      getTaskById: () => Promise.resolve({ id: 5, patientScreeningId: 77, status: "open", createdByUserId: "admin-user" }),
      updateTask: (_id: unknown, patch: unknown) => Promise.resolve({ id: 5, ...(patch as object) }),
    },
    fn: async (baseUrl, calls, spies) => {
      const r = await post(baseUrl, "/api/plexus/tasks/5/call-outcome", { outcome: "callback" });
      assert.equal(r.status, 200);
      assert.equal(countOps(calls, "insert", t.gse), 0, "no canonical write for a non-scheduling task outcome");
      assert.equal(spies.apptStatusWrites.length, 0);
    },
  });
}

// ─── (10) Plexus defer → 202, no false success/appointment write ──
async function testPlexusDeferred() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: new Map<unknown, TableSpec>([
      [t.gse, { select: () => [canonEvent()], onUpdate: () => { const e = new Error("boom") as Error & { code?: string }; e.code = "08006"; throw e; } }],
      [t.journeyEvents, { onInsert: () => [] }],
      [t.carf, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    ]),
    flags: { canonicalAppointment: true },
    session: { userId: "admin-user", role: "admin", clinicId: 1 },
    storage: {
      getTaskById: () => Promise.resolve({ id: 5, patientScreeningId: 77, status: "open", createdByUserId: "admin-user" }),
      updateTask: (_id: unknown, patch: unknown) => Promise.resolve({ id: 5, ...(patch as object) }),
    },
    fn: async (baseUrl, _calls, spies) => {
      const r = await post(baseUrl, "/api/plexus/tasks/5/call-outcome", { outcome: "scheduled", schedulingAction: "no_show", globalScheduleEventId: 555, reason: "x" });
      assert.equal(r.status, 202);
      assert.equal(r.json.retryPending, true);
      assert.equal(spies.apptStatusWrites.length, 0, "deferred must not write appointment truth");
    },
  });
}

// ─── (11) Missing cancel/no-show reason → 409, no false projection ─
async function testMissingReason409() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: engagementSpec(t, { select: () => [canonEvent()], onUpdate: () => [canonEvent({ status: "cancelled" })] }),
    flags: { canonicalAppointment: true },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl, calls) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "cancelled", globalScheduleEventId: 555 });
      assert.equal(r.status, 409, "missing reason is refused");
      assert.equal(countOps(calls, "update", t.gse), 0, "no transition without a reason");
      assert.equal(countOps(calls, "update", t.screenings), 0, "no false projection");
    },
  });
}

// ─── (12) Clinic scope is derived from the request and enforced ───
async function testClinicScopeEnforced() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    // Event belongs to clinic 2; the authenticated request is clinic 1.
    spec: engagementSpec(t, { select: () => [canonEvent({ clinicId: 2 })], onUpdate: () => [canonEvent({ status: "cancelled" })] }),
    flags: { canonicalAppointment: true },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl, calls) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "cancelled", globalScheduleEventId: 555, cancelReason: "x" });
      assert.equal(r.status, 409, "cross-clinic event is denied");
      assert.equal(countOps(calls, "update", t.gse), 0);
    },
  });
}

// ─── (13) Canonical migration failure → controlled 503 ────────────
async function testMigration503() {
  const t = await loadCanonicalTables();
  await withCallResultHttp({
    spec: engagementSpec(t, { select: () => { const e = new Error("no column") as Error & { code?: string }; e.code = "42703"; throw e; } }),
    flags: { canonicalAppointment: true },
    session: { userId: "u1", clinicId: 1 },
    fn: async (baseUrl) => {
      const r = await post(baseUrl, "/api/engagement-center/call-result", { executionCaseId: 900, callResult: "cancelled", globalScheduleEventId: 555, cancelReason: "x" });
      assert.equal(r.status, 503);
      assert.equal(r.json.code, "CANONICAL_APPOINTMENT_MIGRATION_MISSING");
    },
  });
}

// ─── (14) No Twilio/SMS/patient-messaging implementation added ────
async function testNoTwilio() {
  for (const f of [
    "server/services/canonicalAppointments/callResultSchedulingBridge.ts",
    "server/routes/executionCases.ts",
    "server/routes/plexusTasks.ts",
  ]) {
    const raw = readFileSync(join(REPO_ROOT, f), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const re of [/\btwilio\b/i, /patientSms/i, /patient_sms/i, /sendText/i, /sendSms/i]) {
      assert.ok(!re.test(src), `${f} must not implement patient messaging (${re})`);
    }
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) Engagement flag OFF preserves legacy behavior", testEngagementFlagOffLegacy],
  ["(2) Engagement flag ON invokes orchestration for scheduling", testEngagementFlagOnCancel],
  ["(3) Engagement non-scheduling outcome creates no canonical appointment", testEngagementNonSchedulingNoCanonical],
  ["(4/5/6) Engagement deferred → 202, not scheduled, call kept", testEngagementDeferred],
  ["(7) Plexus flag OFF preserves legacy behavior", testPlexusFlagOffLegacy],
  ["(8) Plexus flag ON invokes orchestration for scheduling-state", testPlexusFlagOnCancel],
  ["(9) Plexus non-scheduling outcome performs no canonical write", testPlexusNonSchedulingNoCanonical],
  ["(10) Plexus defer → 202, no false appointment truth", testPlexusDeferred],
  ["(11) missing cancel/no-show reason → 409, no false projection", testMissingReason409],
  ["(12) clinic scope derived from request and enforced", testClinicScopeEnforced],
  ["(13) canonical migration failure → controlled 503", testMigration503],
  ["(14) no Twilio/SMS/patient messaging introduced", testNoTwilio],
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
