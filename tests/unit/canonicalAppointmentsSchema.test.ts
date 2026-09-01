// Phase 2D — canonical ancillary appointment schema/migration contract.
//
// File-based (no DB): asserts migration 0052 and the Drizzle schema
// agree, that the required foreign keys / CHECK constraints / partial-
// unique index exist, that the migration is additive-only, and that
// FEATURE_CANONICAL_APPOINTMENT defaults OFF.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentsSchema.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globalScheduleEvents } from "../../shared/schema/globalSchedule";
import { ancillaryAppointments, insertAncillaryAppointmentSchema } from "../../shared/schema/appointments";
import {
  canonicalAppointmentReconciliationFailures,
  CANONICAL_ANCILLARY_EVENT_TYPES,
  CANONICAL_APPOINTMENT_FAILURE_ACTIONS,
  CANONICAL_APPOINTMENT_STATUSES,
} from "../../shared/schema/canonicalAppointments";
import { patientAncillaryCases } from "../../shared/schema/ancillaryCases";
import { featureFlags } from "../../server/lib/featureFlags";

const REPO_ROOT = process.cwd();
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/0052_add_canonical_ancillary_appointments.sql",
);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

// ─── (1) Migration and Drizzle columns agree ─────────────────────
async function testMigrationAndDrizzleColumnsAgree() {
  const gseCols = Object.keys(globalScheduleEvents);
  for (const c of ["ancillaryCaseId", "parentEventId", "cancellationReason", "noShowReason"]) {
    assert.ok(gseCols.includes(c), `globalScheduleEvents Drizzle missing ${c}`);
  }
  for (const c of ["ancillary_case_id", "parent_event_id", "cancellation_reason", "no_show_reason"]) {
    assert.ok(migrationSql.includes(c), `migration missing global_schedule_events.${c}`);
  }
  // ancillary_appointments back-pointer.
  assert.ok(
    Object.keys(ancillaryAppointments).includes("globalScheduleEventId"),
    "ancillaryAppointments Drizzle missing globalScheduleEventId",
  );
  assert.ok(
    migrationSql.includes("ancillary_appointments") &&
      migrationSql.includes("global_schedule_event_id"),
    "migration missing ancillary_appointments.global_schedule_event_id",
  );
  // retry-ledger columns agree.
  const carfCols = Object.keys(canonicalAppointmentReconciliationFailures);
  for (const c of [
    "clinicId", "ancillaryCaseId", "patientScreeningId", "executionCaseId",
    "provisionalEventId", "requestedAction", "attemptCount", "resolvedAt",
  ]) {
    assert.ok(carfCols.includes(c), `retry-ledger Drizzle missing ${c}`);
  }
}

// ─── (2) ancillary_case_id FK exists ─────────────────────────────
async function testAncillaryCaseFk() {
  assert.ok(
    /CONSTRAINT\s+fk_gse_ancillary_case[\s\S]*?REFERENCES\s+patient_ancillary_cases\s*\(\s*id\s*\)/i.test(migrationSql),
    "global_schedule_events.ancillary_case_id FK → patient_ancillary_cases(id) missing",
  );
}

// ─── (3) parent_event_id self-FK exists ──────────────────────────
async function testParentEventSelfFk() {
  assert.ok(
    /CONSTRAINT\s+fk_gse_parent_event[\s\S]*?REFERENCES\s+global_schedule_events\s*\(\s*id\s*\)/i.test(migrationSql),
    "global_schedule_events.parent_event_id self-FK missing",
  );
}

// ─── (4) ancillary_appointments back-pointer FK exists ───────────
async function testBackPointerFk() {
  assert.ok(
    /CONSTRAINT\s+fk_aa_global_schedule_event[\s\S]*?REFERENCES\s+global_schedule_events\s*\(\s*id\s*\)/i.test(migrationSql),
    "ancillary_appointments.global_schedule_event_id FK missing",
  );
}

// ─── (5) Retry-ledger FKs exist ──────────────────────────────────
async function testRetryLedgerFks() {
  const fks: Array<[string, RegExp]> = [
    ["clinic_id → clinics(id)", /clinic_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+clinics\s*\(\s*id\s*\)/i],
    ["ancillary_case_id → patient_ancillary_cases(id)", /ancillary_case_id\s+INTEGER\s+REFERENCES\s+patient_ancillary_cases\s*\(\s*id\s*\)/i],
    ["patient_screening_id → patient_screenings(id)", /patient_screening_id\s+INTEGER\s+REFERENCES\s+patient_screenings\s*\(\s*id\s*\)/i],
    ["execution_case_id → patient_execution_cases(id)", /execution_case_id\s+INTEGER\s+REFERENCES\s+patient_execution_cases\s*\(\s*id\s*\)/i],
    ["provisional_event_id → global_schedule_events(id)", /provisional_event_id\s+INTEGER\s+REFERENCES\s+global_schedule_events\s*\(\s*id\s*\)/i],
  ];
  for (const [label, re] of fks) {
    assert.ok(re.test(migrationSql), `retry-ledger FK missing: ${label}`);
  }
}

// ─── (6) Canonical event types require ancillary_case_id ─────────
async function testCanonicalTypesRequireCase() {
  assert.ok(
    /CONSTRAINT\s+chk_gse_ancillary_requires_case[\s\S]*?ancillary_appointment[\s\S]*?same_day_add[\s\S]*?ancillary_case_id IS NOT NULL/i.test(migrationSql),
    "CHECK chk_gse_ancillary_requires_case missing/incorrect",
  );
  // Both canonical types present in the catalog.
  assert.deepEqual([...CANONICAL_ANCILLARY_EVENT_TYPES], ["ancillary_appointment", "same_day_add"]);
}

// ─── (7) Cancelled requires cancellation_reason ──────────────────
async function testCancelledRequiresReason() {
  assert.ok(
    /CONSTRAINT\s+chk_gse_cancelled_requires_reason[\s\S]*?status\s*<>\s*'cancelled'[\s\S]*?cancellation_reason IS NOT NULL/i.test(migrationSql),
    "CHECK chk_gse_cancelled_requires_reason missing/incorrect",
  );
}

// ─── (8) No-show requires no_show_reason ─────────────────────────
async function testNoShowRequiresReason() {
  assert.ok(
    /CONSTRAINT\s+chk_gse_no_show_requires_reason[\s\S]*?status\s*<>\s*'no_show'[\s\S]*?no_show_reason IS NOT NULL/i.test(migrationSql),
    "CHECK chk_gse_no_show_requires_reason missing/incorrect",
  );
}

// ─── (9) Partial unique active-appointment index exists ──────────
async function testPartialUniqueIndex() {
  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?uq_gse_active_ancillary_appointment[\s\S]*?ON global_schedule_events\s*\(\s*ancillary_case_id\s*\)[\s\S]*?WHERE[\s\S]*?event_type IN\s*\(\s*'ancillary_appointment',\s*'same_day_add'\s*\)[\s\S]*?status\s*=\s*'scheduled'/i.test(migrationSql),
    "partial-unique uq_gse_active_ancillary_appointment missing/incorrect",
  );
}

// ─── (10) doctor_visit is excluded from the index ────────────────
// Anchor on the CREATE statement (not the rollback comment) and stop
// at the terminating semicolon.
function activeIndexBlock(): string {
  return migrationSql.match(
    /CREATE UNIQUE INDEX[^;]*uq_gse_active_ancillary_appointment[\s\S]*?;/i,
  )?.[0] ?? "";
}

async function testDoctorVisitExcluded() {
  // The index WHERE clause restricts event_type to the two canonical
  // types — doctor_visit can never satisfy it.
  const idx = activeIndexBlock();
  assert.ok(idx.length > 0, "index block not found");
  assert.ok(!/doctor_visit/i.test(idx), "index must not reference doctor_visit");
  assert.ok(/event_type IN\s*\(\s*'ancillary_appointment',\s*'same_day_add'\s*\)/i.test(idx),
    "index must restrict to canonical event types only");
}

// ─── (11) Historical statuses are excluded from the index ────────
async function testHistoricalStatusesExcluded() {
  const idx = activeIndexBlock();
  assert.ok(/status\s*=\s*'scheduled'/i.test(idx), "index must require status='scheduled'");
  for (const s of ["completed", "cancelled", "no_show", "rescheduled"]) {
    // None of the historical statuses may appear as an allowed value.
    assert.ok(!new RegExp(`status\\s*=\\s*'${s}'`).test(idx), `index must exclude status ${s}`);
  }
  // And null ancillary_case_id is excluded.
  assert.ok(/ancillary_case_id IS NOT NULL/i.test(idx), "index must exclude null ancillary_case_id");
}

// ─── (12) No canonical_appointment_id on patient_ancillary_cases ─
async function testNoBackPointerOnAncillaryCase() {
  assert.ok(
    !Object.keys(patientAncillaryCases).includes("canonicalAppointmentId"),
    "patient_ancillary_cases must NOT gain canonicalAppointmentId (canonical event owns the link)",
  );
  assert.ok(
    !migrationSql.includes("canonical_appointment_id"),
    "migration must not add patient_ancillary_cases.canonical_appointment_id",
  );
}

// ─── (13) Migration is additive ──────────────────────────────────
async function testMigrationAdditive() {
  // No destructive DDL/DML in the forward migration. (Rollback notes
  // live in comments, which are stripped for this scan.)
  const noComments = migrationSql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  for (const forbidden of [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\s+\w+\s+SET\b/i,
  ]) {
    assert.ok(!forbidden.test(noComments), `migration forward path must be additive; found ${forbidden}`);
  }
  // Additive markers present.
  assert.ok(/ADD COLUMN IF NOT EXISTS/i.test(migrationSql), "expected additive ADD COLUMN");
  assert.ok(/CREATE TABLE IF NOT EXISTS/i.test(migrationSql), "expected additive CREATE TABLE");
}

// ─── (14) Clinics are never truncated or deleted ─────────────────
async function testClinicsNeverTruncated() {
  const noComments = migrationSql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(!/TRUNCATE[\s\S]*clinics/i.test(noComments), "migration must never truncate clinics");
  assert.ok(!/DELETE\s+FROM\s+clinics/i.test(noComments), "migration must never delete clinics");
  assert.ok(!/DROP\s+TABLE[\s\S]*clinics/i.test(noComments), "migration must never drop clinics");
}

// ─── (15) FEATURE_CANONICAL_APPOINTMENT defaults OFF ─────────────
async function testFeatureFlagDefaultsOff() {
  assert.equal(featureFlags.canonicalAppointment, false, "FEATURE_CANONICAL_APPOINTMENT must default OFF");
}

// ─── Catalog sanity (supports the above) ─────────────────────────
async function testCatalogSanity() {
  assert.deepEqual([...CANONICAL_APPOINTMENT_STATUSES],
    ["scheduled", "completed", "cancelled", "no_show", "rescheduled"]);
  // requested_action CHECK restricts to the approved retry-action set.
  for (const a of CANONICAL_APPOINTMENT_FAILURE_ACTIONS) {
    assert.ok(migrationSql.includes(`'${a}'`), `migration requested_action CHECK missing '${a}'`);
  }
  // The server-owned back-pointer must not be client-settable.
  const shape = (insertAncillaryAppointmentSchema as unknown as { shape?: Record<string, unknown> }).shape;
  if (shape) {
    assert.ok(!("globalScheduleEventId" in shape),
      "insertAncillaryAppointmentSchema must omit server-owned globalScheduleEventId");
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) migration and Drizzle columns agree", testMigrationAndDrizzleColumnsAgree],
  ["(2) ancillary_case_id FK exists", testAncillaryCaseFk],
  ["(3) parent_event_id self-FK exists", testParentEventSelfFk],
  ["(4) ancillary_appointments back-pointer FK exists", testBackPointerFk],
  ["(5) retry-ledger FKs exist", testRetryLedgerFks],
  ["(6) canonical event types require ancillary_case_id", testCanonicalTypesRequireCase],
  ["(7) cancelled requires cancellation_reason", testCancelledRequiresReason],
  ["(8) no_show requires no_show_reason", testNoShowRequiresReason],
  ["(9) partial unique active-appointment index exists", testPartialUniqueIndex],
  ["(10) doctor_visit is excluded", testDoctorVisitExcluded],
  ["(11) historical statuses are excluded", testHistoricalStatusesExcluded],
  ["(12) no canonical_appointment_id on patient_ancillary_cases", testNoBackPointerOnAncillaryCase],
  ["(13) migration is additive", testMigrationAdditive],
  ["(14) clinics are never truncated or deleted", testClinicsNeverTruncated],
  ["(15) FEATURE_CANONICAL_APPOINTMENT defaults OFF", testFeatureFlagDefaultsOff],
  ["(16) catalog sanity", testCatalogSanity],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok  ${name}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${name}\n     ${(e as Error).message}`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${tests.length} tests passed`);
}

run();
