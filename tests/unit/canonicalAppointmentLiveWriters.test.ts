// Phase 2D-B2 — live writer integration (/api/appointments bridge +
// outreach scheduling boundary).
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentLiveWriters.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildFakeDb,
  runWithDb,
  loadCanonicalTables,
  countOps,
  type TableSpec,
  type Call,
} from "../support/canonicalHarness";

const REPO_ROOT = process.cwd();
const START = new Date("2026-07-01T10:00:00Z");
const boundary = () => import("../../server/services/canonicalAppointments/outreachSchedulingOrchestrator");

// ─── /api/appointments HTTP harness ──────────────────────────────
async function withApptHttp<T>(
  spec: Map<unknown, TableSpec>,
  flags: { canonicalAppointment?: boolean; ancillaryCaseWrite?: boolean },
  session: { userId?: string; clinicId?: number | null },
  fn: (baseUrl: string, calls: Call[]) => Promise<T>,
): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const routes = await import("../../server/routes/appointments");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = { ...session };
    (req as unknown as { clinicId: number | null }).clinicId = session.clinicId ?? null;
    next();
  });
  routes.registerAppointmentRoutes(app);
  const httpServer = createServer(app);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const savedFlags = { canonicalAppointment: ff.canonicalAppointment, ancillaryCaseWrite: ff.ancillaryCaseWrite };
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedDb)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  if (flags.canonicalAppointment !== undefined) ff.canonicalAppointment = flags.canonicalAppointment;
  if (flags.ancillaryCaseWrite !== undefined) ff.ancillaryCaseWrite = flags.ancillaryCaseWrite;
  try {
    return await fn(baseUrl, calls);
  } finally {
    for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v;
    ff.canonicalAppointment = savedFlags.canonicalAppointment;
    ff.ancillaryCaseWrite = savedFlags.ancillaryCaseWrite;
    await new Promise<void>((r) => httpServer.close(() => r()));
  }
}

async function post(baseUrl: string, path: string, body: unknown) {
  const resp = await fetch(baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let json: Record<string, unknown> = {};
  try { json = (await resp.json()) as Record<string, unknown>; } catch { /* empty */ }
  return { status: resp.status, json };
}

const APPT_BODY = {
  patientName: "P", facility: "Taylor Family Practice",
  scheduledDate: "2026-07-01", scheduledTime: "10:00", testType: "EchoWave",
};

// ─── (1) /api/appointments flag OFF preserves legacy creation ─────
async function testApptFlagOffLegacy() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryAppointments, { select: () => [], onInsert: (v) => [{ ...v, id: 42 }] }],
  ]);
  await withApptHttp(spec, { canonicalAppointment: false }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    const r = await post(baseUrl, "/api/appointments", APPT_BODY);
    assert.equal(r.status, 200);
    assert.equal((r.json as { id: number }).id, 42);
    assert.equal(countOps(calls, "insert", t.ancillaryAppointments), 1, "legacy insert occurs");
  });
}

// ─── (2) flag ON bridges (screening) or refuses (no screening) ────
async function testApptFlagOnBridgeAndRefuse() {
  const t = await loadCanonicalTables();
  // Refusal: no screening → 409, no legacy row.
  const refuseSpec = new Map<unknown, TableSpec>([[t.ancillaryAppointments, { onInsert: (v) => [{ ...v, id: 1 }] }]]);
  await withApptHttp(refuseSpec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    const r = await post(baseUrl, "/api/appointments", APPT_BODY);
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "CANONICAL_ANCILLARY_CASE_REQUIRED");
    assert.equal(countOps(calls, "insert", t.ancillaryAppointments), 0, "no legacy-only row under canonical mode");
  });
  // Bridge: screening + identity resolves → canonical event.
  const bridgeSpec = new Map<unknown, TableSpec>([
    [t.screenings, { select: () => [{ id: 77, clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20, name: "x", dob: null, facility: "F" }] }],
    [t.clinics, { select: () => [{ id: 1 }] }],
    [t.globalPatients, { select: () => [{ id: 10 }] }],
    [t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] }],
    [t.executionCases, { select: () => [{ id: 900, clinicId: 1 }] }],
    [t.ancillaryCases, { select: () => [{ id: 300, clinicId: 1, serviceType: "EchoWave", originatingScreeningId: 77, executionCaseId: null, episodeSequence: 1, lifecycleStatus: "active", patientClinicMembershipId: 20 }] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 850 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.carf, {}],
    [t.ancillaryAppointments, { select: () => [], onUpdate: () => [] }],
  ]);
  await withApptHttp(bridgeSpec, { canonicalAppointment: true, ancillaryCaseWrite: true }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    const r = await post(baseUrl, "/api/appointments", { ...APPT_BODY, patientScreeningId: 77 });
    assert.equal(r.status, 200);
    assert.equal(r.json.canonical, true);
    assert.equal(r.json.globalScheduleEventId, 850);
    assert.equal(countOps(calls, "insert", t.ancillaryAppointments), 0, "bridge never inserts a legacy-only row");
  });
}

// ─── (3) No legacy-only appointment under canonical mode (covered by 2) ─
async function testNoLegacyRowUnderCanonical() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([[t.ancillaryAppointments, { onInsert: (v) => [{ ...v, id: 1 }] }]]);
  await withApptHttp(spec, { canonicalAppointment: true }, { userId: "u1", clinicId: 1 }, async (baseUrl, calls) => {
    await post(baseUrl, "/api/appointments", APPT_BODY);
    assert.equal(countOps(calls, "insert", t.ancillaryAppointments), 0);
  });
}

// ─── (4) Live outreach path uses the orchestration boundary ───────
async function testOutreachUsesBoundary() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/outreach.ts"), "utf8");
  assert.ok(src.includes("recordOutreachAndSchedulingOutcome"), "outreach route must invoke the boundary");
  assert.ok(/featureFlags\.canonicalAppointment/.test(src), "boundary call must be flag-gated");
}

// ─── (5) Call record remains when scheduling defers/fails ─────────
async function testCallRecordRemainsOnDefer() {
  const t = await loadCanonicalTables();
  const b = await boundary();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => [] }], // complete → not_found (no throw)
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async (calls) => {
    const r = await b.recordOutreachAndSchedulingOutcome({
      clinicId: 1, executionCaseId: 900, patientScreeningId: 77,
      callOutcome: "no_answer", schedulingAction: "complete",
      appointmentInput: { eventId: 999 }, actorUserId: "u1", source: "test",
    });
    assert.ok(countOps(calls, "insert", t.journeyEvents) >= 1, "call outcome audit recorded");
    return r;
  });
  assert.equal(res.callRecorded, true);
  assert.equal(res.ok, false, "scheduling did not succeed");
}

// ─── (6/7) Scheduling failure creates retry; no false success ─────
async function testSchedulingFailureRetryNoFalseSuccess() {
  const t = await loadCanonicalTables();
  const b = await boundary();
  const spec = new Map<unknown, TableSpec>([
    [t.ancillaryCases, { select: () => [{ id: 300, clinicId: 1, serviceType: "EchoWave", originatingScreeningId: null, executionCaseId: null }] }],
    [t.gse, { select: () => [], onInsert: () => { const e = new Error("boom") as Error & { code?: string }; e.code = "08006"; throw e; } }],
    [t.carf, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async (calls) => {
    const r = await b.recordOutreachAndSchedulingOutcome({
      clinicId: 1, executionCaseId: null, ancillaryCaseId: 300,
      callOutcome: "scheduled", schedulingAction: "create",
      appointmentInput: { serviceType: "EchoWave", startsAt: START }, actorUserId: "u1", source: "test",
    });
    assert.ok(countOps(calls, "insert", t.carf) >= 1, "durable retry recorded on scheduling failure");
    return r;
  });
  assert.equal(res.callRecorded, true, "call record preserved");
  assert.equal(res.ok, false, "must NOT claim false success");
  assert.equal(res.scheduling.status, "deferred");
}

// ─── (8) Feature OFF preserves call-result behavior ───────────────
async function testFlagOffPreservesCallResult() {
  const t = await loadCanonicalTables();
  const b = await boundary();
  const spec = new Map<unknown, TableSpec>([
    [t.journeyEvents, { onInsert: () => [] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 1 }] }],
    [t.carf, { onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: false }, async (calls) => {
    const r = await b.recordOutreachAndSchedulingOutcome({
      clinicId: 1, executionCaseId: 900, ancillaryCaseId: 300,
      callOutcome: "scheduled", schedulingAction: "create",
      appointmentInput: { serviceType: "EchoWave", startsAt: START }, source: "test",
    });
    assert.equal(countOps(calls, "insert", t.gse), 0, "flag OFF makes no canonical writes");
    assert.equal(countOps(calls, "insert", t.carf), 0);
    return r;
  });
  assert.equal(res.callRecorded, true, "call outcome still recorded");
  assert.equal(res.scheduling.status, "skipped_flag_off");
}

// ─── (9) No Twilio/SMS/patient-messaging imports ──────────────────
async function testNoTwilioImports() {
  const files = [
    "server/services/canonicalAppointments/outreachSchedulingOrchestrator.ts",
    "server/services/canonicalAppointments/scheduleAncillaryOrchestrator.ts",
    "server/services/canonicalAppointments/quickScheduleLink.ts",
    "server/services/canonicalAppointments/identityCompletionHook.ts",
    "server/services/canonicalAppointments/adoptEvent.ts",
  ];
  for (const f of files) {
    const raw = readFileSync(join(REPO_ROOT, f), "utf8");
    // Strip block + line comments — a docstring may legitimately state
    // "no Twilio/SMS"; we care about actual code references.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const re of [/\btwilio\b/i, /\bsms\b/i, /patientSms/i, /patient_sms/i, /sendText/i]) {
      assert.ok(!re.test(src), `${f} must not reference patient messaging (${re})`);
    }
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) /api/appointments flag OFF legacy behavior", testApptFlagOffLegacy],
  ["(2) /api/appointments flag ON bridge + refusal", testApptFlagOnBridgeAndRefuse],
  ["(3) no legacy-only appointment under canonical mode", testNoLegacyRowUnderCanonical],
  ["(4) live outreach path uses the boundary", testOutreachUsesBoundary],
  ["(5) call record remains when scheduling defers", testCallRecordRemainsOnDefer],
  ["(6/7) scheduling failure creates retry; no false success", testSchedulingFailureRetryNoFalseSuccess],
  ["(8) feature OFF preserves call-result behavior", testFlagOffPreservesCallResult],
  ["(9) no Twilio/SMS/patient messaging imports", testNoTwilioImports],
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
