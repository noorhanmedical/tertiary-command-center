// Phase 2D-B — canonical appointment writer discovery.
//
// Static guard: every ACTIVE ancillary-appointment write must route
// through the canonical service / repository / approved projection when
// FEATURE_CANONICAL_APPOINTMENT is ON. A future writer that inserts an
// ancillary_appointment / same_day_add global_schedule_events row (or
// sets the compatibility back-pointer) outside the allow-list makes
// this test fail.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentWriters.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SERVER_DIR = join(REPO_ROOT, "server");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      out.push(...walk(p));
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const ALL_SERVER_FILES = walk(SERVER_DIR);

function rel(p: string): string {
  return p.slice(REPO_ROOT.length + 1);
}

// ─── (1) Files that INSERT an ancillary-typed global_schedule_events
// row must be on the allow-list. ─────────────────────────────────
const GSE_ANCILLARY_WRITER_ALLOWLIST = new Set([
  // Legacy upsert — used ONLY while the flag is OFF (the route guards).
  "server/repositories/globalSchedule.repo.ts",
  // Canonical repository — the flag-ON writer.
  "server/repositories/canonicalAppointments.repo.ts",
]);

function insertsAncillaryGseEvent(src: string): boolean {
  if (!/\.insert\(\s*globalScheduleEvents\s*\)/.test(src)) return false;
  return /["'](ancillary_appointment|same_day_add)["']/.test(src);
}

async function testGseAncillaryWritersAllowlisted() {
  const offenders: string[] = [];
  for (const file of ALL_SERVER_FILES) {
    const src = readFileSync(file, "utf8");
    if (insertsAncillaryGseEvent(src) && !GSE_ANCILLARY_WRITER_ALLOWLIST.has(rel(file))) {
      offenders.push(rel(file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `ancillary global_schedule_events writers must route through the canonical repo. Offenders: ${offenders.join(", ")}`,
  );
}

// ─── (2) Files that WRITE the ancillary_appointments compatibility
// back-pointer (global_schedule_event_id) must be on the allow-list. ─
const BACKPOINTER_WRITER_ALLOWLIST = new Set([
  // The single approved projection helper.
  "server/services/canonicalAppointments/legacyProjection.ts",
]);

function writesBackPointer(src: string): boolean {
  // An UPDATE/INSERT that sets globalScheduleEventId on ancillary_appointments.
  if (!/ancillaryAppointments/.test(src)) return false;
  return /globalScheduleEventId\s*:/.test(src) && /\.(update|insert)\(\s*ancillaryAppointments\s*\)/.test(src);
}

async function testBackPointerWritersAllowlisted() {
  const offenders: string[] = [];
  for (const file of ALL_SERVER_FILES) {
    const src = readFileSync(file, "utf8");
    if (writesBackPointer(src) && !BACKPOINTER_WRITER_ALLOWLIST.has(rel(file))) {
      offenders.push(rel(file));
    }
  }
  assert.deepEqual(offenders, [], `back-pointer writers must be the approved projection helper. Offenders: ${offenders.join(", ")}`);
}

// ─── (3) The live schedule-ancillary route guards on the flag and
// routes ON traffic through the canonical orchestrator BEFORE the
// legacy upsert. ─────────────────────────────────────────────────
async function testScheduleAncillaryRouteWiredCanonical() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/globalSchedule.ts"), "utf8");
  assert.ok(
    src.includes("scheduleCanonicalAncillaryAppointment"),
    "schedule-ancillary route must call the canonical orchestrator",
  );
  const flagIdx = src.indexOf("featureFlags.canonicalAppointment");
  const legacyIdx = src.indexOf("upsertAncillaryScheduleEvent({");
  assert.ok(flagIdx > 0, "route must reference featureFlags.canonicalAppointment");
  assert.ok(legacyIdx > 0, "route must retain the legacy upsert for flag-OFF");
  assert.ok(flagIdx < legacyIdx, "canonical flag branch must precede the legacy upsert");
}

// ─── (4) The transition route routes canonical ancillary transitions
// through the domain service. ─────────────────────────────────────
async function testTransitionRouteWiredCanonical() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/globalSchedule.ts"), "utf8");
  assert.ok(
    src.includes("applyCanonicalAncillaryTransition"),
    "transition route must call applyCanonicalAncillaryTransition",
  );
  // Canonical decision must precede the legacy applyScheduleTransition.
  assert.ok(
    src.indexOf("applyCanonicalAncillaryTransition") < src.indexOf("applyScheduleTransition({"),
    "canonical transition routing must precede the legacy writer",
  );
}

// ─── (5) The canonical write repo is flag-guarded (no unguarded
// canonical writes). ─────────────────────────────────────────────
async function testCanonicalRepoFlagGuarded() {
  const src = readFileSync(join(REPO_ROOT, "server/repositories/canonicalAppointments.repo.ts"), "utf8");
  assert.ok(src.includes("guardWrite()"), "canonical repo must have a write guard");
  assert.ok(
    /featureFlags\.canonicalAppointment/.test(src),
    "canonical repo write guard must check FEATURE_CANONICAL_APPOINTMENT",
  );
}

// ─── (6) The legacy null-case upsert is NOT reachable under flag ON.
// The route returns before it; assert the guard comment/contract. ──
async function testLegacyUpsertUnreachableUnderFlagOn() {
  const src = readFileSync(join(REPO_ROOT, "server/routes/globalSchedule.ts"), "utf8");
  // Between the flag branch and the legacy upsert there must be a
  // `return` in every canonical outcome (created/reused/deferred/503).
  const flagBlock = src.slice(
    src.indexOf("if (featureFlags.canonicalAppointment)"),
    src.indexOf("upsertAncillaryScheduleEvent({"),
  );
  const returns = (flagBlock.match(/return res\./g) ?? []).length;
  assert.ok(returns >= 3, "flag-ON branch must return for created/reused, deferred, and 503 outcomes");
}

// ─── (7) The projection helper never rewrites doctor_visit. ───────
async function testProjectionExcludesDoctorVisit() {
  const src = readFileSync(join(REPO_ROOT, "server/services/canonicalAppointments/legacyProjection.ts"), "utf8");
  assert.ok(
    src.includes("CANONICAL_ANCILLARY_EVENT_TYPES"),
    "projection must restrict to canonical ancillary event types (excludes doctor_visit)",
  );
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) ancillary global_schedule_events writers are allow-listed", testGseAncillaryWritersAllowlisted],
  ["(2) compatibility back-pointer writers are allow-listed", testBackPointerWritersAllowlisted],
  ["(3) schedule-ancillary route routes through canonical before legacy", testScheduleAncillaryRouteWiredCanonical],
  ["(4) transition route routes through canonical before legacy", testTransitionRouteWiredCanonical],
  ["(5) canonical write repo is flag-guarded", testCanonicalRepoFlagGuarded],
  ["(6) legacy null-case upsert unreachable under flag ON", testLegacyUpsertUnreachableUnderFlagOn],
  ["(7) projection excludes doctor_visit", testProjectionExcludesDoctorVisit],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok  ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).message}`); }
  }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}

run();
