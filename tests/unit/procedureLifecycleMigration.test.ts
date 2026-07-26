// Phase 2F — migration 0054 additive/legacy-safety + no-forbidden-behavior guards.
//
//   npx tsx tests/unit/procedureLifecycleMigration.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATION = readFileSync(join(ROOT, "migrations/0054_add_canonical_procedure_lifecycle.sql"), "utf8");
const ELIGIBILITY_SRC = readFileSync(join(ROOT, "server/services/procedureLifecycle/procedureNoteEligibility.ts"), "utf8");
const NOTE_SRC = readFileSync(join(ROOT, "server/services/procedureLifecycle/procedureNoteService.ts"), "utf8");
const ORCH_SRC = readFileSync(join(ROOT, "server/services/procedureLifecycle/procedureLifecycleOrchestration.ts"), "utf8");
const SCHEMA_SRC = readFileSync(join(ROOT, "shared/schema/ancillaryDocuments.ts"), "utf8");
const ALL_SERVICE_SRC = ELIGIBILITY_SRC + NOTE_SRC + ORCH_SRC;

// Statement-splitting helper — ignores SQL line comments so a comment that
// mentions e.g. "TRUNCATE" or "DROP TABLE" never trips a body-level guard.
function sqlBody(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
const BODY = sqlBody(MIGRATION);
const BODY_UP = BODY.toUpperCase();

// (21) migration 0054 is additive — only ADD COLUMN / CREATE INDEX /
//      DROP INDEX / DROP+ADD CONSTRAINT; no destructive column/type rewrites.
async function testAdditive() {
  assert.ok(/ALTER TABLE procedure_events\s+ADD COLUMN IF NOT EXISTS ancillary_case_id/i.test(BODY), "adds procedure_events.ancillary_case_id");
  assert.ok(/ALTER TABLE procedure_notes\s+ADD COLUMN IF NOT EXISTS report_document_reference_id/i.test(BODY), "adds procedure_notes.report_document_reference_id");
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_pn_post_procedure_note_active_case/i.test(BODY), "adds case-scoped post_procedure_note identity");
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS uq_pn_post_procedure_note_legacy/i.test(BODY), "keeps legacy unlinked post_procedure_note identity");
  // No destructive column rewrites.
  assert.ok(!/DROP COLUMN/i.test(BODY_UP), "no DROP COLUMN");
  assert.ok(!/ALTER COLUMN/i.test(BODY_UP), "no ALTER COLUMN (type/null rewrites)");
  assert.ok(!/\bRENAME\b/i.test(BODY_UP), "no RENAME");
}

// (22) migration 0054 deletes no data
async function testNoDataDeletion() {
  // "ON DELETE SET NULL" (a FK action) is not a data deletion — guard on
  // an actual DELETE statement.
  assert.ok(!/\bDELETE\s+FROM\b/i.test(BODY_UP), "no DELETE FROM");
  assert.ok(!/DROP TABLE/i.test(BODY_UP), "no DROP TABLE");
  // Only index definitions may be dropped (never data).
  const drops = BODY_UP.match(/\bDROP\s+(\w+)/g) ?? [];
  for (const d of drops) {
    assert.ok(/DROP\s+(INDEX|CONSTRAINT)/.test(d), `only DROP INDEX/CONSTRAINT allowed, saw: ${d}`);
  }
}

// (23) migration 0054 never truncates clinics (or anything)
async function testNoTruncateClinics() {
  assert.ok(!/TRUNCATE/i.test(BODY_UP), "no TRUNCATE anywhere");
  // No mutation of the clinics table (no UPDATE/DELETE/ALTER on clinics).
  assert.ok(!/\b(UPDATE|DELETE|ALTER TABLE)\s+CLINICS\b/i.test(BODY_UP), "no clinics mutation");
}

// (24) legacy unlinked post-procedure-note writes remain valid with flags OFF:
//      no case-required CHECK / NOT NULL is imposed on the identity columns.
async function testLegacyWritersRemainValid() {
  // "ancillary_case_id IS NOT NULL" (a partial-index WHERE predicate) is fine;
  // a column-level NOT NULL constraint is what would break legacy inserts.
  assert.ok(!/(?<!IS )\bNOT NULL\b/i.test(BODY_UP), "no column NOT NULL imposed (would break legacy inserts)");
  assert.ok(!/ADD CONSTRAINT\s+\w*\s*CHECK\s*\([^)]*ancillary_case_id/i.test(BODY), "no case-required CHECK on procedure rows");
  // The legacy partial (ancillary_case_id IS NULL) must survive so
  // createPendingProcedureNotes keeps inserting unlinked post_procedure_notes.
  assert.ok(/uq_pn_post_procedure_note_legacy[\s\S]*ancillary_case_id IS NULL/i.test(BODY), "legacy unlinked identity preserved");
  // The two CHECK replacements only WIDEN (strict superset) — never remove a value.
  assert.ok(/CHECK \(document_kind IN \([^)]*'procedure_note'[^)]*\)\)/i.test(BODY), "document_kind widened to include procedure_note");
}

// (25) no billing_document behavior exists in this checkpoint
async function testNoBillingDocument() {
  assert.ok(!/CREATE TABLE[^;]*billing_document/i.test(BODY), "no billing_document table created");
  assert.ok(!/'billing_document'/i.test(BODY), "billing_document not added to any CHECK");
  assert.ok(!/billing_document/i.test(ALL_SERVICE_SRC), "no billing_document reference in Phase 2F services");
}

// (26) no clinical Procedure Note body is generated
async function testNoBodyGeneration() {
  assert.ok(!/generatedText/i.test(ALL_SERVICE_SRC), "services never write generatedText");
  assert.ok(!/openai|generateNote|generate_note|generatedByAi:\s*true/i.test(ALL_SERVICE_SRC), "no note-body generation");
  // generationStatus is always left 'pending'.
  assert.ok(/generationStatus:\s*"pending"/.test(NOTE_SRC), "generationStatus stays pending");
}

// (27) no Twilio / SMS / patient messaging exists
async function testNoTwilioSms() {
  // Use the comment-stripped migration body: a "Twilio / SMS: NEVER" guard
  // COMMENT is desirable and must not trip this check.
  const haystack = (ALL_SERVICE_SRC + BODY).toLowerCase();
  for (const token of ["twilio", "sms", "text message", "patient messaging"]) {
    assert.ok(!haystack.includes(token), `must not reference: ${token}`);
  }
}

// (bonus) reconciliation actions + schema kinds are wired for Procedure Notes
async function testReconciliationWiring() {
  assert.ok(/'link_procedure_note'/.test(BODY) && /'link_procedure_note_evidence'/.test(BODY), "migration adds procedure-note retry actions");
  assert.ok(/"procedure_note"/.test(SCHEMA_SRC), "schema kinds include procedure_note");
  assert.ok(/"link_procedure_note"/.test(SCHEMA_SRC) && /"link_procedure_note_evidence"/.test(SCHEMA_SRC), "schema actions include procedure-note retries");
  // Never auto-sign: no signature stamping in the Phase 2F services.
  assert.ok(!/signatureStatus:\s*"signed"|signedAt:\s*new Date\(\)/.test(ALL_SERVICE_SRC), "(no auto-sign) never stamps a signature");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(21) migration 0054 is additive", testAdditive],
  ["(22) migration 0054 deletes no data", testNoDataDeletion],
  ["(23) migration 0054 never truncates clinics", testNoTruncateClinics],
  ["(24) legacy unlinked post-procedure-note writes remain valid with flags OFF", testLegacyWritersRemainValid],
  ["(25) no billing_document behavior exists", testNoBillingDocument],
  ["(26) no clinical note body is generated", testNoBodyGeneration],
  ["(27) no Twilio/SMS/patient messaging exists", testNoTwilioSms],
  ["(bonus) Procedure Note reconciliation + no-auto-sign wiring", testReconciliationWiring],
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
