// Phase 2G — legacy billing compatibility (pre-migration-0055 query generation).
//
// Proves the LEGACY Drizzle objects generate SQL that references NO
// migration-0055 column, so legacy readiness/document repositories + routes stay
// executable while migration 0055 is UNAPPLIED and every Phase 2G flag is OFF.
// The CANONICAL objects (used only by Phase 2G under flags) DO reference them.
//
//   npx tsx tests/unit/billingLegacyCompatibility.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";

const MIGRATION_0055_COLUMNS = [
  "ancillary_case_id", "canonical_status", "evidence_fingerprint", "generated_body",
  "superseded_at", "billing_blockers", "claim_blockers", "applied_overrides",
  "evidence_snapshot", "evaluated_at", "report_document_reference_id",
  "order_note_document_reference_id", "procedure_note_document_reference_id",
  "supersedes_billing_document_id", "generated_at",
];

async function db() { return (await import("../../server/db")).db; }
async function schema() {
  const br = await import("../../shared/schema/billingReadiness");
  const bd = await import("../../shared/schema/billingDocuments");
  return { br, bd };
}

function sqlOf(q: { toSQL: () => { sql: string } }): string { return q.toSQL().sql.toLowerCase(); }

// (2a) legacy readiness SELECT references no 0055 column
async function testLegacyReadinessSelect() {
  const d = await db(); const { br } = await schema();
  const sql = sqlOf(d.select().from(br.billingReadinessChecks));
  for (const col of MIGRATION_0055_COLUMNS) assert.ok(!sql.includes(col), `legacy readiness SELECT must not reference ${col} (got: ${sql})`);
  // Sanity: it DOES select the pre-0055 columns.
  assert.ok(sql.includes("readiness_status") && sql.includes("service_type"), "legacy readiness selects pre-0055 columns");
}

// (2b) legacy document SELECT references no 0055 column
async function testLegacyDocumentSelect() {
  const d = await db(); const { bd } = await schema();
  const sql = sqlOf(d.select().from(bd.billingDocumentRequests));
  for (const col of MIGRATION_0055_COLUMNS) assert.ok(!sql.includes(col), `legacy document SELECT must not reference ${col}`);
  assert.ok(sql.includes("request_status"), "legacy document selects pre-0055 columns");
}

// (2c) legacy INSERT ... RETURNING references no 0055 column
async function testLegacyInsertReturning() {
  const d = await db(); const { br, bd } = await schema();
  const rSql = sqlOf(d.insert(br.billingReadinessChecks).values({ serviceType: "BrainWave" } as never).returning());
  for (const col of MIGRATION_0055_COLUMNS) assert.ok(!rSql.includes(col), `legacy readiness INSERT RETURNING must not reference ${col}`);
  const dSql = sqlOf(d.insert(bd.billingDocumentRequests).values({ serviceType: "BrainWave" } as never).returning());
  for (const col of MIGRATION_0055_COLUMNS) assert.ok(!dSql.includes(col), `legacy document INSERT RETURNING must not reference ${col}`);
}

// (2d) legacy UPDATE ... RETURNING references no 0055 column
async function testLegacyUpdateReturning() {
  const d = await db(); const { br } = await schema();
  const sql = sqlOf(d.update(br.billingReadinessChecks).set({ readinessStatus: "ready_to_generate" }).returning());
  for (const col of MIGRATION_0055_COLUMNS) assert.ok(!sql.includes(col), `legacy readiness UPDATE RETURNING must not reference ${col}`);
}

// (2e) the CANONICAL objects DO reference the 0055 columns (used only under flags)
async function testCanonicalObjectsReference0055() {
  const d = await db(); const { br, bd } = await schema();
  const rSql = sqlOf(d.select().from(br.canonicalBillingReadinessChecks));
  assert.ok(rSql.includes("ancillary_case_id") && rSql.includes("canonical_status") && rSql.includes("evidence_fingerprint"), "canonical readiness selects 0055 columns");
  const dSql = sqlOf(d.select().from(bd.canonicalBillingDocumentRequests));
  assert.ok(dSql.includes("ancillary_case_id") && dSql.includes("canonical_status") && dSql.includes("generated_body"), "canonical document selects 0055 columns");
}

// (2f) legacy repositories import the LEGACY (pre-0055) objects, not canonical ones
async function testLegacyReposUseLegacyObjects() {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const f of ["server/repositories/billingReadiness.repo.ts", "server/repositories/billingDocuments.repo.ts"]) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(!src.includes("canonicalBillingReadinessChecks") && !src.includes("canonicalBillingDocumentRequests"), `${f} must not use canonical billing objects`);
  }
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(2a) legacy readiness SELECT no 0055 columns", testLegacyReadinessSelect],
  ["(2b) legacy document SELECT no 0055 columns", testLegacyDocumentSelect],
  ["(2c) legacy INSERT RETURNING no 0055 columns", testLegacyInsertReturning],
  ["(2d) legacy UPDATE RETURNING no 0055 columns", testLegacyUpdateReturning],
  ["(2e) canonical objects reference 0055 columns", testCanonicalObjectsReference0055],
  ["(2f) legacy repos use legacy objects", testLegacyReposUseLegacyObjects],
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
