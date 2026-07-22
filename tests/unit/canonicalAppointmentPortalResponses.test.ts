// Phase 2D-C2 — canonical appointment portal API responses.
//
// Proves the portal-facing serialized responses (Patient EHR endpoint,
// Engagement cases, PCS/scheduler byService, ACS, Global Calendar) all
// carry the SAME canonical event identity with JSON-safe timestamps,
// separate doctor_visit, correct history vs active, eligibility, tenant
// scope, controlled 503, and flag-OFF zero reads.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentPortalResponses.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildFakeDb, runWithDb, loadCanonicalTables, countOps, type TableSpec, type Call } from "../support/canonicalHarness";

const START = new Date("2026-12-01T10:00:00Z");
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
const caseRow = (id = 300, serviceType = "EchoWave") => ({ id, serviceType, clinicId: 1 });
function projSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, events: unknown[], cases: unknown[]): Map<unknown, TableSpec> {
  return new Map<unknown, TableSpec>([
    [t.gse, { select: () => events }],
    [t.ancillaryCases, { select: () => cases }],
  ]);
}

async function withRoutesHttp<T>(register: (app: Express) => void, spec: Map<unknown, TableSpec>, flag: boolean, session: { clinicId?: number | null }, fn: (baseUrl: string, calls: Call[]) => Promise<T>): Promise<T> {
  const dbMod = await import("../../server/db");
  const flagMod = await import("../../server/lib/featureFlags");
  const dbObj = dbMod.db as unknown as Record<string, unknown>;
  const ff = flagMod.featureFlags as unknown as Record<string, boolean>;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { clinicId: number | null }).clinicId = session.clinicId ?? null; (req as unknown as { session: unknown }).session = { userId: "u1", clinicId: session.clinicId }; next(); });
  register(app);
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

// ─── (1) Patient EHR endpoint returns canonical event ID + ISO ────
async function testEhr() {
  const t = await loadCanonicalTables();
  const routes = await import("../../server/routes/globalSchedule");
  await withRoutesHttp(routes.registerGlobalScheduleRoutes, projSpec(t, [evt()], [caseRow()]), true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?patientScreeningId=77&byService=true&includeHistory=true");
    const body = r.json as { appointmentByService: Record<string, { activeAppointment: { globalScheduleEventId: number; startsAt: string } }> };
    const a = body.appointmentByService["EchoWave"].activeAppointment;
    assert.equal(a.globalScheduleEventId, 700);
    assert.equal(typeof a.startsAt, "string", "JSON-safe ISO timestamp");
    assert.equal(a.startsAt, START.toISOString());
  });
}

// ─── (2) Engagement cases returns same event ID ───────────────────
async function testEngagement() {
  const t = await loadCanonicalTables();
  const routes = await import("../../server/routes/executionCases");
  const spec = new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [{ id: 900, clinicId: 1, patientScreeningId: 77, engagementStatus: "new", lifecycleStatus: "active", selectedServices: ["EchoWave"], nextActionAt: null, priorityScore: 0, createdAt: START }] }],
    [t.gse, { select: () => [evt()] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
  ]);
  await withRoutesHttp(routes.registerExecutionCaseRoutes, spec, true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/engagement-center/cases?withAppointments=true");
    const rows = r.json as Array<{ id: number; appointmentByService?: Record<string, { activeAppointment: { globalScheduleEventId: number } }> }>;
    const row = rows.find((x) => x.id === 900)!;
    assert.equal(row.appointmentByService?.["EchoWave"].activeAppointment.globalScheduleEventId, 700);
  });
}

// ─── (3/6) PCS + scheduler byService returns same event ID ────────
async function testPcsScheduler() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const byService = await runWithDb(projSpec(t, [evt()], [caseRow()]), { canonicalAppointment: true }, async () =>
    p.getSerializedAppointmentsByService({ clinicId: 1, executionCaseId: 900 }),
  );
  assert.equal(byService["EchoWave"].activeAppointment?.globalScheduleEventId, 700);
  assert.equal(typeof byService["EchoWave"].activeAppointment?.startsAt, "string");
}

// ─── (4) ACS returns same event ID ────────────────────────────────
async function testAcs() {
  const t = await loadCanonicalTables();
  const a = await acs();
  const spec = new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [{ id: 900, clinicId: 1, patientName: "P", facilityId: "F", engagementStatus: "scheduled", assignedTeamMemberId: null }] }],
    [t.gse, { select: () => [evt()] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
  ]);
  const snap = await runWithDb(spec, { canonicalAppointment: true }, async () => a.getAcsWorkflowSnapshot(900));
  assert.equal(snap!.nextScheduleEvent?.id, 700);
  assert.equal(snap!.appointmentByService?.["EchoWave"].activeAppointment?.globalScheduleEventId, 700);
}

// ─── (5/8) Calendar returns same ID; doctor_visit separate ────────
async function testCalendar() {
  const t = await loadCanonicalTables();
  const routes = await import("../../server/routes/globalSchedule");
  await withRoutesHttp(routes.registerGlobalScheduleRoutes, projSpec(t, [evt(), evt({ id: 701, eventType: "doctor_visit", ancillaryCaseId: null })], []), true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/global-schedule-events");
    const rows = r.json as Array<Record<string, unknown>>;
    const anc = rows.find((x) => x.eventType === "ancillary_appointment")!;
    const doc = rows.find((x) => x.eventType === "doctor_visit")!;
    assert.equal(anc.globalScheduleEventId, 700);
    assert.equal(anc.canonicalAncillary, true);
    assert.ok(!("canonicalAncillary" in doc), "doctor_visit stays a separate general event");
  });
}

// ─── (7) Different services retain different event IDs ────────────
async function testDifferentServices() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const events = [evt({ id: 700, ancillaryCaseId: 300, serviceType: "EchoWave" }), evt({ id: 800, ancillaryCaseId: 301, serviceType: "SleepWave" })];
  const byService = await runWithDb(projSpec(t, events, [caseRow(300, "EchoWave"), caseRow(301, "SleepWave")]), { canonicalAppointment: true }, async () =>
    p.getSerializedAppointmentsByService({ clinicId: 1, executionCaseId: 900 }),
  );
  assert.equal(byService["EchoWave"].activeAppointment?.globalScheduleEventId, 700);
  assert.equal(byService["SleepWave"].activeAppointment?.globalScheduleEventId, 800);
}

// ─── (9/10/11/12) history vs active in serialized projection ──────
async function testHistoryVsActive() {
  const t = await loadCanonicalTables();
  const p = await proj();
  async function serial(events: unknown[]) {
    return runWithDb(projSpec(t, events, [caseRow()]), { canonicalAppointment: true }, async () =>
      p.getSerializedAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300, includeHistory: true }),
    );
  }
  let r = await serial([evt({ id: 700, status: "cancelled", cancellationReason: "x" })]);
  assert.equal(r.activeAppointment, null);
  assert.ok(r.appointmentHistory.some((h) => h.globalScheduleEventId === 700), "(9) cancelled is history");
  r = await serial([evt({ id: 700, status: "no_show", noShowReason: "x" })]);
  assert.equal(r.activeAppointment, null);
  assert.ok(r.appointmentHistory.some((h) => h.status === "no_show"), "(10) no_show is history");
  r = await serial([evt({ id: 700, status: "rescheduled" }), evt({ id: 701, status: "scheduled", parentEventId: 700, startsAt: new Date("2027-01-01T10:00:00Z") })]);
  assert.equal(r.activeAppointment?.globalScheduleEventId, 701, "(12) child is active");
  assert.equal(r.activeAppointment?.parentEventId, 700);
  assert.ok(r.appointmentHistory.some((h) => h.globalScheduleEventId === 700), "(11) prior is history");
}

// ─── (13) Order Note eligibility surfaced ─────────────────────────
async function testEligibilitySurfaced() {
  const t = await loadCanonicalTables();
  const routes = await import("../../server/routes/globalSchedule");
  await withRoutesHttp(routes.registerGlobalScheduleRoutes, projSpec(t, [evt()], [caseRow()]), true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?ancillaryCaseId=300");
    const body = r.json as { appointmentEligibleForOrderNote: boolean; appointmentEligibilityReason: string };
    assert.equal(body.appointmentEligibleForOrderNote, true);
    assert.equal(body.appointmentEligibilityReason, "qualifying_appointment");
  });
}

// ─── (14) Cross-clinic data is absent ─────────────────────────────
async function testCrossClinic() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const r = await runWithDb(projSpec(t, [evt({ clinicId: 2 })], [caseRow()]), { canonicalAppointment: true }, async () =>
    p.getSerializedAppointmentProjection({ clinicId: 1, ancillaryCaseId: 300, includeHistory: true }),
  );
  assert.equal(r.activeAppointment, null);
  assert.equal(r.appointmentHistory.length, 0);
}

// ─── (15/17) Feature OFF: no canonical query, no legacy fallback ──
async function testFlagOff() {
  const t = await loadCanonicalTables();
  const routes = await import("../../server/routes/globalSchedule");
  await withRoutesHttp(routes.registerGlobalScheduleRoutes, projSpec(t, [evt()], [caseRow()]), false, { clinicId: 1 }, async (baseUrl, calls) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?ancillaryCaseId=300");
    assert.equal((r.json as { enabled: boolean }).enabled, false);
    assert.equal(countOps(calls, "select"), 0, "flag OFF issues zero canonical reads");
  });
}

// ─── (16/17) Missing migration → 503, no legacy fallback ──────────
async function testMissingMigration() {
  const t = await loadCanonicalTables();
  const routes = await import("../../server/routes/globalSchedule");
  const spec = new Map<unknown, TableSpec>([
    [t.gse, { select: () => { const e = new Error("no col") as Error & { code?: string }; e.code = "42703"; throw e; } }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
  ]);
  await withRoutesHttp(routes.registerGlobalScheduleRoutes, spec, true, { clinicId: 1 }, async (baseUrl) => {
    const r = await getJson(baseUrl, "/api/canonical-appointments?ancillaryCaseId=300");
    assert.equal(r.status, 503);
    assert.equal((r.json as { code: string }).code, "CANONICAL_APPOINTMENT_MIGRATION_MISSING");
    assert.ok(!("activeAppointment" in (r.json as object)), "no legacy fallback data");
  });
}

// ─── Client discovery guard: canonical consumers use the shared
// contract, not legacy inference. ────────────────────────────────
const REPO_ROOT = process.cwd();
async function testClientDiscoveryGuard() {
  // The shared client contract exists and is the single source.
  const contract = readFileSync(join(REPO_ROOT, "shared/types/canonicalAppointment.ts"), "utf8");
  assert.ok(/AncillaryAppointmentProjection/.test(contract) && /CanonicalAppointmentView/.test(contract),
    "shared serializable contract must exist");
  // The shared component consumes the projection via the shared contract
  // and is gated by the canonical UI flag at its call site (ACS panel).
  const acsPanel = readFileSync(join(REPO_ROOT, "client/src/components/portal/AcsWorkflowPanel.tsx"), "utf8");
  assert.ok(/isCanonicalAppointmentUiEnabled\(\)/.test(acsPanel), "canonical UI must be flag-gated");
  assert.ok(/appointmentByService/.test(acsPanel), "must consume the canonical projection, not legacy fields");
  // The shared component + model must NOT infer scheduling from legacy
  // signals (appointmentStatus / selectedServices / doctor_visit / a raw
  // ancillary_appointments row).
  for (const f of [
    "client/src/components/canonical/CanonicalAppointmentSummary.tsx",
    "client/src/components/canonical/appointmentSummaryModel.ts",
  ]) {
    const src = readFileSync(join(REPO_ROOT, f), "utf8");
    for (const legacy of ["appointmentStatus", "selectedServices", "doctor_visit", "ancillary_appointments"]) {
      assert.ok(!src.includes(legacy), `${f} must not infer scheduling from legacy signal: ${legacy}`);
    }
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(discovery) client consumers use the shared canonical contract", testClientDiscoveryGuard],
  ["(1) Patient EHR endpoint returns canonical event ID + ISO", testEhr],
  ["(2) Engagement cases returns same event ID", testEngagement],
  ["(3/6) PCS + scheduler byService returns same event ID", testPcsScheduler],
  ["(4) ACS returns same event ID", testAcs],
  ["(5/8) Calendar returns same ID; doctor_visit separate", testCalendar],
  ["(7) different services retain different event IDs", testDifferentServices],
  ["(9/10/11/12) history vs active", testHistoryVsActive],
  ["(13) Order Note eligibility surfaced", testEligibilitySurfaced],
  ["(14) cross-clinic data is absent", testCrossClinic],
  ["(15/17) feature OFF: no canonical query, no fallback", testFlagOff],
  ["(16/17) missing migration → 503, no legacy fallback", testMissingMigration],
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
