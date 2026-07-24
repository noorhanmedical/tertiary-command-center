// Phase 2E-A — ancillary document reference schema/migration contract.
//
// File-based (no DB): migration 0053 ↔ Drizzle alignment, FKs, unique
// source constraint, allowed Phase 2E kinds (no procedure_note /
// billing_document), no document bytes / full note text in the index,
// PHI-free retry ledger, additive migration, no clinic truncation, and
// both Phase 2E flags default OFF.
//
//   npx tsx tests/unit/ancillaryDocumentsSchema.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ancillaryDocumentReferences,
  ancillaryDocumentReconciliationFailures,
  ANCILLARY_DOCUMENT_KINDS,
  ANCILLARY_DOCUMENT_STATUSES,
  ANCILLARY_DOCUMENT_FAILURE_ACTIONS,
} from "../../shared/schema/ancillaryDocuments";
import { featureFlags } from "../../server/lib/featureFlags";

const ROOT = process.cwd();
const MIGRATION = readFileSync(join(ROOT, "migrations/0053_add_unified_ancillary_documents.sql"), "utf8");
const noComments = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

async function testMigrationDrizzleAlign() {
  const cols = Object.keys(ancillaryDocumentReferences);
  for (const c of ["clinicId", "globalPlexusPatientId", "patientClinicMembershipId", "patientScreeningId", "executionCaseId", "ancillaryCaseId", "documentKind", "sourceTable", "sourceId", "serviceType", "documentStatus", "effectiveClinicalDate", "actualCreatedAt", "signedAt", "supersededAt", "createdByUserId", "metadata"]) {
    assert.ok(cols.includes(c), `Drizzle missing ${c}`);
  }
  for (const c of ["clinic_id", "global_plexus_patient_id", "patient_clinic_membership_id", "patient_screening_id", "execution_case_id", "ancillary_case_id", "document_kind", "source_table", "source_id", "service_type", "document_status", "effective_clinical_date", "actual_created_at", "signed_at", "superseded_at", "created_by_user_id", "metadata"]) {
    assert.ok(MIGRATION.includes(c), `migration missing column ${c}`);
  }
  assert.ok(MIGRATION.includes("ancillary_document_references"));
  assert.ok(MIGRATION.includes("ancillary_document_reconciliation_failures"));
}

async function testRealFks() {
  const fks: Array<[string, RegExp]> = [
    ["clinic_id → clinics", /clinic_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+clinics\(id\)/i],
    ["ancillary_case_id → patient_ancillary_cases", /ancillary_case_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+patient_ancillary_cases\(id\)/i],
    ["global_plexus_patient_id → global_plexus_patients", /global_plexus_patient_id\s+INTEGER\s+REFERENCES\s+global_plexus_patients\(id\)/i],
    ["patient_clinic_membership_id → patient_clinic_memberships", /patient_clinic_membership_id\s+INTEGER\s+REFERENCES\s+patient_clinic_memberships\(id\)/i],
    ["patient_screening_id → patient_screenings", /patient_screening_id\s+INTEGER\s+REFERENCES\s+patient_screenings\(id\)/i],
    ["execution_case_id → patient_execution_cases", /execution_case_id\s+INTEGER\s+REFERENCES\s+patient_execution_cases\(id\)/i],
    ["created_by_user_id → users", /created_by_user_id\s+VARCHAR\s+REFERENCES\s+users\(id\)/i],
  ];
  for (const [label, re] of fks) assert.ok(re.test(MIGRATION), `missing FK: ${label}`);
}

async function testUniqueSourceConstraint() {
  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?uq_adr_source[\s\S]*?\(source_table, source_id, document_kind\)/i.test(MIGRATION),
    "unique (source_table, source_id, document_kind) missing",
  );
  assert.ok(
    /CREATE UNIQUE INDEX[\s\S]*?uq_adr_active_per_case_kind[\s\S]*?\(ancillary_case_id, document_kind\)[\s\S]*?WHERE superseded_at IS NULL/i.test(MIGRATION),
    "active-per-case-kind partial unique index missing",
  );
}

async function testAllowedKinds() {
  assert.deepEqual([...ANCILLARY_DOCUMENT_KINDS], ["order_note", "report", "consent", "screening_form"]);
  assert.ok(/document_kind IN \('order_note','report','consent','screening_form'\)/i.test(MIGRATION), "kind CHECK missing/incorrect");
}

async function testNoProcedureNoteKind() {
  // The registry must not introduce a procedure_note document kind.
  assert.ok(!(ANCILLARY_DOCUMENT_KINDS as readonly string[]).includes("procedure_note"), "procedure_note must not be a registry kind");
  const kindCheck = MIGRATION.match(/document_kind IN \([^)]*\)/i)?.[0] ?? "";
  assert.ok(!/procedure_note/.test(kindCheck), "procedure_note must not appear in the kind CHECK");
}

async function testNoBillingDocumentKind() {
  assert.ok(!(ANCILLARY_DOCUMENT_KINDS as readonly string[]).includes("billing_document"), "billing_document must not be a registry kind");
  const kindCheck = MIGRATION.match(/document_kind IN \([^)]*\)/i)?.[0] ?? "";
  assert.ok(!/billing_document/.test(kindCheck), "billing_document must not appear in the kind CHECK");
}

async function testNoDocumentBytesOrBody() {
  const drizzleCols = Object.keys(ancillaryDocumentReferences).join(",").toLowerCase();
  for (const forbidden of ["generatedtext", "notetext", "content", "bytes", "storagepath", "blob", "filedata", "body"]) {
    assert.ok(!drizzleCols.includes(forbidden), `registry must not store document body/bytes: ${forbidden}`);
  }
  const sqlLower = MIGRATION.toLowerCase();
  for (const forbidden of ["generated_text", "note_text", "storage_path", "file_bytes", "content_bytes"]) {
    assert.ok(!sqlLower.includes(forbidden), `migration must not add document body/bytes column: ${forbidden}`);
  }
}

async function testRetryLedgerNoPhi() {
  const cols = Object.keys(ancillaryDocumentReconciliationFailures).join(",").toLowerCase();
  for (const phi of ["patientname", "patient_name", "dob", "mrn", "phone", "insurance", "diagnosis"]) {
    assert.ok(!cols.includes(phi), `retry ledger must not carry PHI column: ${phi}`);
  }
  assert.deepEqual([...ANCILLARY_DOCUMENT_FAILURE_ACTIONS], [
    "create_reference", "refresh_projection", "link_order_note", "link_report",
    "link_consent", "link_screening_form", "supersede_reference",
  ]);
  for (const a of ANCILLARY_DOCUMENT_FAILURE_ACTIONS) {
    assert.ok(MIGRATION.includes(`'${a}'`), `retry action CHECK missing '${a}'`);
  }
}

async function testAdditiveMigration() {
  for (const re of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bUPDATE\s+\w+\s+SET\b/i]) {
    assert.ok(!re.test(noComments), `migration forward path must be additive; found ${re}`);
  }
  assert.ok(/CREATE TABLE IF NOT EXISTS/i.test(MIGRATION), "expected additive CREATE TABLE");
}

async function testNoClinicTruncation() {
  assert.ok(!/TRUNCATE[\s\S]*clinics/i.test(noComments));
  assert.ok(!/DELETE\s+FROM\s+clinics/i.test(noComments));
  assert.ok(!/DROP\s+TABLE[\s\S]*clinics/i.test(noComments));
}

async function testFlagsDefaultOff() {
  assert.equal(featureFlags.unifiedAncillaryDocuments, false, "FEATURE_UNIFIED_ANCILLARY_DOCUMENTS must default OFF");
  assert.equal(featureFlags.canonicalOrderNote, false, "FEATURE_CANONICAL_ORDER_NOTE must default OFF");
}

async function testStatusValues() {
  assert.deepEqual([...ANCILLARY_DOCUMENT_STATUSES], ["pending", "pending_signature", "signed", "uploaded", "superseded", "voided"]);
  assert.ok(/document_status IN \('pending','pending_signature','signed','uploaded','superseded','voided'\)/i.test(MIGRATION), "status CHECK missing/incorrect");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) migration ↔ Drizzle alignment", testMigrationDrizzleAlign],
  ["(2) real FKs", testRealFks],
  ["(3) unique source reference constraint", testUniqueSourceConstraint],
  ["(4) allowed Phase 2E document kinds", testAllowedKinds],
  ["(5) procedure_note generation not introduced", testNoProcedureNoteKind],
  ["(6) billing_document kind not introduced", testNoBillingDocumentKind],
  ["(7) no document bytes/full note body in registry", testNoDocumentBytesOrBody],
  ["(8) retry ledger contains no PHI fields", testRetryLedgerNoPhi],
  ["(9) additive migration", testAdditiveMigration],
  ["(10) no clinic truncation", testNoClinicTruncation],
  ["(11) feature flags default OFF", testFlagsDefaultOff],
  ["(12) status values are the reviewed workflow set", testStatusValues],
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
