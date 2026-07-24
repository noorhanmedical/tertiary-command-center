// Phase 2D-B2 — identity-completion hook + retry worker/CLI + backfill
// adoption integration.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentRetryIntegration.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runWithDb,
  loadCanonicalTables,
  countOps,
  type TableSpec,
} from "../support/canonicalHarness";

const REPO_ROOT = process.cwd();
const START = new Date("2026-08-01T10:00:00Z");
const hook = () => import("../../server/services/canonicalAppointments/identityCompletionHook");
const worker = () => import("../../server/services/canonicalAppointments/retryWorker");
const proj = () => import("../../server/services/canonicalAppointments/legacyProjection");

function execRow(over: Record<string, unknown> = {}) {
  return { id: 900, clinicId: 1, patientScreeningId: 77, source: "quick_schedule", selectedServices: ["EchoWave"], facilityId: "F", nextActionAt: START, ...over };
}
function screeningRow(over: Record<string, unknown> = {}) {
  return { id: 77, clinicId: 1, globalPlexusPatientId: 10, patientClinicMembershipId: 20, name: "x", dob: null, facility: "F", ...over };
}
function caseRow() {
  return { id: 300, clinicId: 1, serviceType: "EchoWave", originatingScreeningId: 77, executionCaseId: 900, episodeSequence: 1, lifecycleStatus: "active", patientClinicMembershipId: 20, globalPlexusPatientId: 10 };
}
function hookSpec(t: Awaited<ReturnType<typeof loadCanonicalTables>>, over: Partial<Record<string, TableSpec>> = {}) {
  const spec = new Map<unknown, TableSpec>([
    [t.executionCases, { select: () => [execRow()] }],
    [t.screenings, { select: () => [screeningRow()] }],
    [t.ancillaryFailures, { select: () => [], onUpdate: (v) => [{ ...v }] }],
    [t.clinics, { select: () => [{ id: 1 }] }],
    [t.globalPatients, { select: () => [{ id: 10 }] }],
    [t.memberships, { select: () => [{ id: 20, clinicId: 1, globalPlexusPatientId: 10 }] }],
    [t.ancillaryCases, { select: () => [caseRow()] }],
    [t.gse, { select: () => [], onInsert: (v) => [{ ...v, id: 500 }] }],
    [t.journeyEvents, { onInsert: () => [] }],
    [t.carf, { select: () => [], onUpdate: (v) => [{ ...v }] }],
    [t.ancillaryAppointments, { select: () => [], onUpdate: () => [] }],
  ]);
  for (const [k, v] of Object.entries(over)) spec.set((t as Record<string, unknown>)[k], v);
  return spec;
}

// ─── (1) Identity completion invokes quick-schedule finalization ──
async function testIdentityCompletionInvokes() {
  const t = await loadCanonicalTables();
  const h = await hook();
  const res = await runWithDb(hookSpec(t), { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await h.finalizeQuickScheduleForLinkedScreening({ screeningId: 77, clinicId: 1, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 1, "finalization creates one canonical event");
    return r;
  });
  assert.equal(res.status, "finalized");
  if (res.status === "finalized") assert.equal(res.result.status, "linked");
}

// ─── (2) Same hook is idempotent (no duplicate events) ────────────
async function testHookIdempotent() {
  const t = await loadCanonicalTables();
  const h = await hook();
  // getActive already returns a scheduled same_day_add → reuse.
  const spec = hookSpec(t, {
    gse: { select: () => [{ id: 500, ancillaryCaseId: 300, eventType: "same_day_add", serviceType: "EchoWave", status: "scheduled" }], onInsert: (v) => [{ ...v, id: 501 }] },
  });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await h.finalizeQuickScheduleForLinkedScreening({ screeningId: 77, clinicId: 1, source: "test" });
    assert.equal(countOps(calls, "insert", t.gse), 0, "idempotent — no duplicate event");
    assert.equal(r.status, "finalized");
  });
}

// ─── (3) Cross-clinic finalization refused ────────────────────────
async function testCrossClinicRefused() {
  const t = await loadCanonicalTables();
  const h = await hook();
  const spec = hookSpec(t, { executionCases: { select: () => [execRow({ clinicId: 2 })] } });
  await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    const r = await h.finalizeQuickScheduleForLinkedScreening({ screeningId: 77, clinicId: 1, source: "test" });
    assert.equal(r.status, "cross_clinic_skipped");
    assert.equal(countOps(calls, "insert", t.gse), 0, "no cross-clinic canonical write");
  });
}

// ─── (4) Phase 2B retry closes on success ─────────────────────────
async function testPhase2BClosed() {
  const t = await loadCanonicalTables();
  const h = await hook();
  await runWithDb(hookSpec(t), { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    await h.finalizeQuickScheduleForLinkedScreening({ screeningId: 77, clinicId: 1, source: "test" });
    assert.ok(countOps(calls, "update", t.ancillaryFailures) >= 1, "Phase 2B retry row resolved");
  });
}

// ─── (5) Phase 2D retry closes on success ─────────────────────────
async function testPhase2DClosed() {
  const t = await loadCanonicalTables();
  const h = await hook();
  await runWithDb(hookSpec(t), { canonicalAppointment: true, ancillaryCaseWrite: true }, async (calls) => {
    await h.finalizeQuickScheduleForLinkedScreening({ screeningId: 77, clinicId: 1, source: "test" });
    assert.ok(countOps(calls, "update", t.carf) >= 1, "Phase 2D retry row resolved");
  });
}

// ─── (6) Retry CLI/job reaches the retry service ──────────────────
async function testRetryWorkerReachesService() {
  const t = await loadCanonicalTables();
  const w = await worker();
  // carf list returns one link_quick_schedule failure → worker drives finalize → resolved.
  const spec = hookSpec(t, {
    carf: {
      select: () => [{ id: 1, requestedAction: "link_quick_schedule", clinicId: 1, executionCaseId: 900, patientScreeningId: 77, provisionalEventId: null, resolvedAt: null }],
      onUpdate: (v) => [{ ...v }],
    },
  });
  const res = await runWithDb(spec, { canonicalAppointment: true, ancillaryCaseWrite: true }, async () =>
    w.retryUnresolvedCanonicalAppointmentFailures({ limit: 10 }),
  );
  assert.equal(res.processed, 1);
  assert.equal(res.outcomes[0].status, "resolved", "worker reached finalize and resolved the row");
  // Structural: the CLI entry point calls the worker service.
  const cli = readFileSync(join(REPO_ROOT, "script/retryCanonicalAppointmentFailures.ts"), "utf8");
  assert.ok(cli.includes("retryUnresolvedCanonicalAppointmentFailures"), "CLI must reach the retry service");
}

// ─── (7) Worker/CLI is bounded ────────────────────────────────────
async function testWorkerBounded() {
  const cli = readFileSync(join(REPO_ROOT, "script/retryCanonicalAppointmentFailures.ts"), "utf8");
  assert.ok(/Math\.min\([^)]*500\)/.test(cli), "CLI must cap the batch size (<=500)");
  assert.ok(!/while\s*\(\s*true\s*\)/.test(cli), "CLI must not run an infinite loop");
  const repo = readFileSync(join(REPO_ROOT, "server/repositories/canonicalAppointments.repo.ts"), "utf8");
  assert.ok(/Math\.min\(Math\.max\(1[^)]*\)[^)]*500\)/.test(repo), "repo list must cap the limit");
}

// ─── (8) Worker/CLI output contains no PHI ────────────────────────
async function testWorkerNoPhi() {
  const cli = readFileSync(join(REPO_ROOT, "script/retryCanonicalAppointmentFailures.ts"), "utf8");
  for (const phi of ["patientName", "patientDob", "patient_name", "patient_dob", ".name", ".dob"]) {
    assert.ok(!cli.includes(phi), `retry CLI output must not reference PHI field: ${phi}`);
  }
  // The worker's outcome shape is ids + action + status only.
  const workerSrc = readFileSync(join(REPO_ROOT, "server/services/canonicalAppointments/retryWorker.ts"), "utf8");
  assert.ok(!/patientName|patientDob/.test(workerSrc), "retry worker must not carry PHI in outcomes");
}

// ─── (9) Backfill uses adoption service, not raw canonical-link update ─
async function testBackfillUsesAdoptionService() {
  const src = readFileSync(join(REPO_ROOT, "script/backfillCanonicalAppointments.ts"), "utf8");
  assert.ok(src.includes("adoptExistingScheduleEventAsCanonical"), "backfill must use the adoption service");
  assert.ok(
    !/\.update\(\s*globalScheduleEvents\s*\)[\s\S]{0,120}ancillaryCaseId/.test(src),
    "backfill must NOT raw-update global_schedule_events.ancillary_case_id",
  );
}

// ─── (10) Conflicting legacy back-pointer is not overwritten ──────
async function testBackPointerConflictNotOverwritten() {
  const t = await loadCanonicalTables();
  const p = await proj();
  const evt = { id: 555, clinicId: 1, ancillaryCaseId: 300, eventType: "ancillary_appointment", serviceType: "EchoWave", status: "scheduled", patientScreeningId: 77, executionCaseId: 900, startsAt: START } as never;
  const spec = new Map<unknown, TableSpec>([
    // A legacy row already points to a DIFFERENT canonical event.
    [t.ancillaryAppointments, { select: () => [{ id: 1, globalScheduleEventId: 999 }], onUpdate: () => [] }],
    [t.carf, { onInsert: (v) => [{ ...v, id: 1 }] }],
  ]);
  const res = await runWithDb(spec, { canonicalAppointment: true }, async (calls) => {
    const r = await p.refreshLegacyAppointmentProjection({ canonicalEvent: evt, source: "test" });
    assert.equal(countOps(calls, "update", t.ancillaryAppointments), 0, "must NOT overwrite a conflicting back-pointer");
    assert.ok(countOps(calls, "insert", t.carf) >= 1, "conflict records a durable retry");
    return r;
  });
  assert.equal(res.ok, false);
  if (res.ok === false) assert.equal(res.errorCode, "backpointer_conflict");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) identity completion invokes quick-schedule finalization", testIdentityCompletionInvokes],
  ["(2) same hook is idempotent", testHookIdempotent],
  ["(3) cross-clinic finalization refused", testCrossClinicRefused],
  ["(4) Phase 2B retry closes on success", testPhase2BClosed],
  ["(5) Phase 2D retry closes on success", testPhase2DClosed],
  ["(6) retry CLI/job reaches retry service", testRetryWorkerReachesService],
  ["(7) worker/CLI is bounded", testWorkerBounded],
  ["(8) worker/CLI output contains no PHI", testWorkerNoPhi],
  ["(9) backfill uses adoption service", testBackfillUsesAdoptionService],
  ["(10) conflicting legacy back-pointer not overwritten", testBackPointerConflictNotOverwritten],
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
