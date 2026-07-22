// Phase 2D-C1 — canonical appointment reader behavior.
//
// Proves every clinic-facing surface reads the SAME canonical event
// identity via the shared projection layer, that doctor_visit stays
// separate, history vs active is correct, tenant scope is enforced,
// missing-migration is a controlled 503, and flag OFF performs zero
// canonical reads.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentReaders.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildFakeDb, runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const REPO_ROOT = process.cwd();
const START = new Date("2026-10-01T10:00:00Z");
const proj = () => import("../../server/services/canonicalAppointments/appointmentProjection");
const acs = () => import("../../server/services/ancillary/acsWorkflowRuntime");

function evt(over: Record<string, unknown> = {}) {
  return {
    id: 700, clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment",
    serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900,
    patientName: null, patientDob: null, facilityId: "F", startsAt: START, endsAt: null,
    parentEventId: null, cancellationReason: null, noShowReason: null, source: "scheduler_portal",
    metadata: {}, createdAt: START, updatedAt: START, ...over,
  };
}
function caseRow(id = 300, serviceType = "EchoWave") {
  return { id, serviceType, clinicId: 1 };
}
function projSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, events: unknown[], cases: unknown[]): Map<unknown, TableSpec> {
  return new Map<unknown, TableSpec>([
    [t.gse, { select: () => events }],
    [t.ancillaryCases, { select: () => cases }],
  ]);
}

// ─── HTTP harness (globalSchedule routes: calendar + canonical endpoint) ──
async function withGsHttp<T>(spec: Map<unknown, TableSpec>, flag: boolean, session: { clinicId?: number | null }, fn: (baseUrl: string, calls: Call[]) => Promise<T>): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const routes = await import("../../server/routes/globalSchedule");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { clinicId: number | null }).clinicId = session.clinicId ?? null; next(); });
  routes.registerGlobalScheduleRoutes(app);
  const httpServer = createServer(app);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const savedDb: Record<string, unknown> = {};
  for (const k of ["select", "insert", "update", "delete", "transaction", "execute"]) savedDb[k] = dbObj[k];
  const savedFlag = ff.canonicalAppointment;
  const { db: fake, calls } = buildFakeDb(spec);
  for (const k of Object.keys(savedDb)) dbObj[k] = (fake as unknown as Record<string, unknown>)[k];
  ff.canonicalAppointment = flag;
  try { return await fn(baseUrl, calls); }
  finally {
    for (const [k, v] of Object.entries(savedDb)) dbObj[k] = v;
    ff.canonicalAppointment = savedFlag;
    await new Promise<void>((r) => httpServer.close(() => r()));
  }
}
async function getJson(baseUrl: string, path: string) {
  const resp = await fetch(baseUrl + path);
  let json: unknown = null;
  try { json = await resp.json(); } catch { /* */ }
  return { status: resp.status, json };
}

// ─── (1) Global Calendar returns canonical event ID ───────────────
async function testCalendarEventId() {
  const t = await loadCanonicalTables();
  await withGsHttp(projSpec(t, [evt(), { ...evt({ id: 701, eventType: "doctor_visit", ancillaryCaseId: null }) }], []), true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/global-schedule-events");
    const rows = r.json as Array<Record<string, unknown>>;
    const ancillary = rows.find((x) => x.eventType === "ancillary_appointment")!;
    const doctor = rows.find((x) => x.eventType === "doctor_visit")!;
    assert.equal(ancillary.globalScheduleEventId, 700, "ancillary event exposes canonical id");
    assert.equal(ancillary.canonicalAncillary, true);
    // (7) doctor_visit stays separate — not tagged canonical ancillary.
    assert.ok(!("canonicalAncillary" in doctor), "doctor_visit is not a canonical ancillary event");
  });
}

// ─── (2) Patient EHR reads same event ID via canonical endpoint ───
async function testEhrSameEventId() {
  const t = await loadCanonicalTables();
  await withGsHttp(projSpec(t, [evt()], [caseRow()]), true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?patientScreeningId=77&includeHistory=true");
    const body = r.json as { activeAppointment: { globalScheduleEventId: number } };
    assert.equal(body.activeAppointment.globalScheduleEventId, 700);
  });
}

// ─── (3/4/6) Engagement/PCS/Scheduler read same ID via projection ─
async function testProjectionSameIdAcrossDimensions() {
  const t = await loadCanonicalTables();
  const p = await proj();
  for (const q of [{ ancillaryCaseId: 300 }, { patientScreeningId: 77 }, { executionCaseId: 900 }]) {
    const r = await runWithDb(projSpec(t, [evt()], [caseRow()]), { canonicalAppointment: true }, async () =>
      p.getCanonicalAppointmentProjection({ clinicId: 1, ...q }),
    );
    assert.equal(r.activeAppointment?.globalScheduleEventId, 700, `same event id for ${JSON.stringify(q)}`);
  }
  // byService (Engagement/PCS grouping) yields the same id.
  const byService = await runWithDb(projSpec(t, [evt()], [caseRow()]), { canonicalAppointment: true }, async () =>
    p.getCanonicalAppointmentsByService({ clinicId: 1, executionCaseId: 900 }),
  );
  assert.equal(byService["EchoWave"].activeAppointment?.globalScheduleEventId, 700);
}

// ─── (5) ACS reads the same canonical event ID ────────────────────
async function testAcsSameEventId() {
  const t = await loadCanonicalTables();
  const a = await acs();
  const spec = new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [{ id: 900, clinicId: 1, patientName: "P", facilityId: "F", engagementStatus: "scheduled", assignedTeamMemberId: null }] }],
    [t.gse, { select: () => [evt()] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
  ]);
  const snap = await runWithDb(spec, { canonicalAppointment: true }, async () => a.getAcsWorkflowSnapshot(900));
  assert.ok(snap);
  assert.equal(snap!.nextScheduleEvent?.id, 700, "ACS active event is the canonical event");
  assert.equal(snap!.appointmentByService?.["EchoWave"].activeAppointment?.globalScheduleEventId, 700);
}

// ─── (8) Different services retain different appointment IDs ───────
async function testDifferentServicesDifferentIds() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const events = [evt({ id: 700, ancillaryCaseId: 300, serviceType: "EchoWave" }), evt({ id: 800, ancillaryCaseId: 301, serviceType: "SleepWave" })];
  const cases = [caseRow(300, "EchoWave"), caseRow(301, "SleepWave")];
  const byService = await runWithDb(projSpec(t, events, cases), { canonicalAppointment: true }, async () =>
    p.getCanonicalAppointmentsByService({ clinicId: 1, executionCaseId: 900 }),
  );
  assert.equal(byService["EchoWave"].activeAppointment?.globalScheduleEventId, 700);
  assert.equal(byService["SleepWave"].activeAppointment?.globalScheduleEventId, 800);
}

// ─── (9/10/11/12) history vs active ───────────────────────────────
async function testHistoryVsActive() {
  const t = await loadCanonicalTables();
  const p = await proj();
  async function project(events: unknown[]) {
    return runWithDb(projSpec(t, events, [caseRow()]), { canonicalAppointment: true }, async () =>
      p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300, includeHistory: true }),
    );
  }
  // (9) cancelled → history, not active
  let r = await project([evt({ id: 700, status: "cancelled", cancellationReason: "x" })]);
  assert.equal(r.activeAppointment, null);
  assert.ok(r.appointmentHistory.some((h) => h.globalScheduleEventId === 700 && h.status === "cancelled"));
  // (10) no_show → history
  r = await project([evt({ id: 700, status: "no_show", noShowReason: "x" })]);
  assert.equal(r.activeAppointment, null);
  assert.ok(r.appointmentHistory.some((h) => h.status === "no_show"));
  // (11/12) rescheduled prior is history; new child is active
  r = await project([
    evt({ id: 700, status: "rescheduled" }),
    evt({ id: 701, status: "scheduled", parentEventId: 700, startsAt: new Date("2026-11-01T10:00:00Z") }),
  ]);
  assert.equal(r.activeAppointment?.globalScheduleEventId, 701, "child is active");
  assert.equal(r.activeAppointment?.parentEventId, 700, "child references prior");
  assert.ok(r.appointmentHistory.some((h) => h.globalScheduleEventId === 700 && h.status === "rescheduled"), "prior is history");
}

// ─── (7b) doctor_visit is never an active ancillary appointment ───
async function testDoctorVisitExcluded() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const r = await runWithDb(projSpec(t, [evt({ id: 700, eventType: "doctor_visit" })], [caseRow()]), { canonicalAppointment: true }, async () =>
    p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300, includeHistory: true }),
  );
  assert.equal(r.activeAppointment, null, "doctor_visit is never an ancillary active appointment");
}

// ─── (13) Cross-clinic read is denied ─────────────────────────────
async function testCrossClinicDenied() {
  const t = await loadCanonicalTables();
  const p = await proj();
  // Event belongs to clinic 2; the reader is scoped to clinic 1.
  const r = await runWithDb(projSpec(t, [evt({ clinicId: 2 })], [caseRow()]), { canonicalAppointment: true }, async () =>
    p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300, includeHistory: true }),
  );
  assert.equal(r.activeAppointment, null, "another clinic's event is not returned");
  assert.equal(r.appointmentHistory.length, 0);
}

// ─── (14/16) Missing migration flag ON → controlled 503, no fallback ─
async function testMissingMigration503() {
  const t = await loadCanonicalTables();
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => { const e = new Error("no col") as Error & { code?: string }; e.code = "42703"; throw e; } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
  ]);
  await withGsHttp(spec, true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?ancillaryCaseId=300");
    assert.equal(r.status, 503, "missing migration → controlled 503");
    assert.equal((r.json as { code: string }).code, "CANONICAL_APPOINTMENT_MIGRATION_MISSING");
    // (16) no unrestricted legacy fallback — body carries no appointment rows.
    assert.ok(!("activeAppointment" in (r.json as object)), "no legacy fallback data leaked");
  });
}

// ─── (15) Feature OFF performs zero canonical reads ───────────────
async function testFlagOffZeroReads() {
  const t = await loadCanonicalTables();
  const p = await proj();
  await runWithDb(projSpec(t, [evt()], [caseRow()]), { canonicalAppointment: false }, async (calls) => {
    const r = await p.getCanonicalAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300 });
    assert.equal(r.flagOff, true);
    assert.equal(r.activeAppointment, null);
    assert.equal(countOps(calls, "select"), 0, "flag OFF issues zero canonical reads");
  });
  // The HTTP endpoint likewise performs no reads and reports disabled.
  await withGsHttp(projSpec(t, [evt()], [caseRow()]), false, { clinicId: 1 }, async (baseUrl, calls) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?ancillaryCaseId=300");
    assert.equal((r.json as { enabled: boolean }).enabled, false);
    assert.equal(countOps(calls, "select"), 0);
  });
}

// ─── Discovery guard: readers use the canonical projection/repo ───
async function testReaderDiscoveryGuard() {
  const projSrc = readFileSync(join(REPO_ROOT, "server/services/canonicalAppointments/appointmentProjection.ts"), "utf8");
  assert.ok(projSrc.includes("canonicalAppointments.repo") || projSrc.includes("../../repositories/canonicalAppointments.repo"),
    "projection must read canonical truth from canonicalAppointments.repo");
  assert.ok(projSrc.includes("CANONICAL_ANCILLARY_EVENT_TYPES"), "projection must exclude doctor_visit via the canonical type set");
  // ACS reader uses the projection under the flag (not a raw status-free scan).
  const acsSrc = readFileSync(join(REPO_ROOT, "server/services/ancillary/acsWorkflowRuntime.ts"), "utf8");
  assert.ok(acsSrc.includes("getCanonicalAppointmentsByService"), "ACS must read via the canonical projection under the flag");
  assert.ok(/featureFlags\.canonicalAppointment/.test(acsSrc), "ACS canonical read must be flag-gated");
  // Engagement cases + calendar + canonical endpoint use the projection.
  const gs = readFileSync(join(REPO_ROOT, "server/routes/globalSchedule.ts"), "utf8");
  assert.ok(gs.includes("getCanonicalAppointmentProjection") && gs.includes("/api/canonical-appointments"), "calendar routes must expose the canonical projection endpoint");
  const exec = readFileSync(join(REPO_ROOT, "server/routes/executionCases.ts"), "utf8");
  assert.ok(exec.includes("getCanonicalAppointmentsByService"), "engagement cases must attach canonical per-service projection");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1/7) Global Calendar returns canonical event ID; doctor_visit separate", testCalendarEventId],
  ["(2) Patient EHR reads same event ID (canonical endpoint)", testEhrSameEventId],
  ["(3/4/6) Engagement/PCS/Scheduler read same ID via projection", testProjectionSameIdAcrossDimensions],
  ["(5) ACS reads the same canonical event ID", testAcsSameEventId],
  ["(8) different services retain different appointment IDs", testDifferentServicesDifferentIds],
  ["(9/10/11/12) history vs active", testHistoryVsActive],
  ["(7b) doctor_visit is never an active ancillary appointment", testDoctorVisitExcluded],
  ["(13) cross-clinic read is denied", testCrossClinicDenied],
  ["(14/16) missing migration → 503, no legacy fallback", testMissingMigration503],
  ["(15) feature OFF performs zero canonical reads", testFlagOffZeroReads],
  ["(discovery) readers use the canonical projection/repo", testReaderDiscoveryGuard],
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
