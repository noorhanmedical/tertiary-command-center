// 0077 — canonical ancillary_service_prerequisite_config seed guards.
//
// Static assertions on the seed migration + schema enum. Proves the seed is
// deterministic, idempotent, non-destructive, covers the 7 supported services,
// and stays in lockstep with the billing-readiness evaluator's stage +
// requirement code. No DB required.
//
//   npx tsx tests/unit/ancillaryPrerequisiteSeed.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SEED = readFileSync(join(ROOT, "migrations/0077_seed_ancillary_prerequisite_config.sql"), "utf8");
const SEED_PROC = readFileSync(join(ROOT, "migrations/0078_seed_procedure_start_signed_order_prereq.sql"), "utf8");
const EVALUATOR = readFileSync(join(ROOT, "server/services/billingLifecycle/billingReadinessEvaluator.ts"), "utf8");
const SCHEMA = readFileSync(join(ROOT, "shared/schema/procedurePrerequisites.ts"), "utf8");

function sqlBody(src: string): string {
  return src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
}
const BODY = sqlBody(SEED);
const BODY_UP = BODY.toUpperCase();
const PROC = sqlBody(SEED_PROC);
const PROC_UP = PROC.toUpperCase();

const SERVICES = [
  "BrainWave",
  "VitalWave",
  "Echocardiogram TTE",
  "Bilateral Carotid Duplex",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Lower Extremity Venous Duplex",
];

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: (e as Error).message }); }
}

// ── Coverage ──
test("seeds all 7 supported services", () => {
  for (const s of SERVICES) {
    assert.ok(BODY.includes(`('${s}')`), `missing seed row for ${s}`);
  }
});

test("seeds the order_note_signature requirement at the billing_readiness stage", () => {
  assert.match(BODY, /'order_note_signature'/);
  assert.match(BODY, /'billing_readiness'/);
});

test("seed requirement is required=TRUE and not overrideable", () => {
  // The single INSERT ... SELECT uses TRUE, FALSE, TRUE, TRUE = required,
  // override_allowed=false, override_audit_required, active.
  assert.match(BODY, /TRUE,\s*FALSE,\s*TRUE,\s*TRUE/);
});

// ── Idempotency + safety ──
test("insert is idempotent against the platform-default partial-unique index", () => {
  assert.match(BODY, /ON CONFLICT\s*\(\s*service_type,\s*requirement_code,\s*blocks_stage\s*\)/i);
  assert.match(BODY, /WHERE\s+clinic_id\s+IS\s+NULL/i);
  assert.match(BODY, /DO NOTHING/i);
});

test("seeds PLATFORM DEFAULTS (clinic_id NULL), never clinic-specific rows", () => {
  assert.match(BODY, /SELECT NULL,\s*s,\s*'order_note_signature'/i);
});

test("non-destructive: no DELETE / DROP TABLE / TRUNCATE / UPDATE", () => {
  assert.ok(!/\bDELETE\s+FROM\b/.test(BODY_UP), "no DELETE FROM");
  assert.ok(!/DROP\s+TABLE/.test(BODY_UP), "no DROP TABLE");
  assert.ok(!/TRUNCATE/.test(BODY_UP), "no TRUNCATE");
  assert.ok(!/\bUPDATE\b/.test(BODY_UP), "no UPDATE");
});

test("the only DROP is the CHECK-constraint refresh (idempotent widen)", () => {
  const drops = BODY_UP.match(/\bDROP\s+(\w+)/g) ?? [];
  for (const d of drops) {
    assert.ok(/DROP\s+CONSTRAINT/.test(d), `only DROP CONSTRAINT allowed, saw: ${d}`);
  }
  assert.match(BODY, /DROP CONSTRAINT IF EXISTS chk_aspc_blocks_stage/i);
});

test("CHECK refresh WIDENS the allowed stage set (adds billing_readiness, keeps the originals)", () => {
  for (const stage of ["scheduling", "check_in", "procedure_start", "billing", "billing_readiness", "claim_submission"]) {
    assert.ok(BODY.includes(`'${stage}'`), `CHECK must still allow ${stage}`);
  }
});

test("wrapped in a single transaction", () => {
  assert.match(BODY, /^\s*BEGIN;/m);
  assert.match(BODY, /COMMIT;\s*$/);
});

// ── Lockstep with the evaluator ──
test("stage + requirement code match the billing-readiness evaluator", () => {
  assert.match(EVALUATOR, /BILLING_READINESS_STAGE\s*=\s*"billing_readiness"/);
  assert.match(EVALUATOR, /requirementCode === "order_note_signature"/);
});

test("schema enum documents the billing_readiness stage", () => {
  assert.match(SCHEMA, /"billing_readiness"/);
});

// ── 0078 — procedure-start signed-order eligibility gate ──
test("0078 seeds order_note_signature at the procedure_start stage for all canonical services", () => {
  assert.match(PROC, /'order_note_signature'/);
  assert.match(PROC, /'procedure_start'/);
  assert.match(PROC, /'hard_procedure_blocker'/);
  // The 7 headline services plus the rest of the canonical catalog.
  for (const s of [...SERVICES, "Upper Extremity Arterial Doppler", "Upper Extremity Venous Duplex", "Stress Echocardiogram", "Abdominal Aortic Aneurysm Duplex"]) {
    assert.ok(PROC.includes(`('${s}')`), `0078 missing procedure_start row for ${s}`);
  }
});

test("0078 is idempotent, platform-default, and non-destructive", () => {
  assert.match(PROC, /ON CONFLICT\s*\(\s*service_type,\s*requirement_code,\s*blocks_stage\s*\)/i);
  assert.match(PROC, /WHERE\s+clinic_id\s+IS\s+NULL/i);
  assert.match(PROC, /DO NOTHING/i);
  assert.match(PROC, /SELECT NULL,\s*s,\s*'order_note_signature'/i);
  assert.ok(!/\bDELETE\s+FROM\b/.test(PROC_UP), "no DELETE FROM");
  assert.ok(!/DROP\s+TABLE/.test(PROC_UP), "no DROP TABLE");
  assert.ok(!/TRUNCATE/.test(PROC_UP), "no TRUNCATE");
  assert.ok(!/\bUPDATE\b/.test(PROC_UP), "no UPDATE");
  assert.ok(!/\bALTER\b/.test(PROC_UP), "0078 needs no constraint change (procedure_start already allowed)");
});

test("0078 does NOT touch migration 0077 (different stage → disjoint key)", () => {
  // 0078 seeds procedure_start; 0077 seeds billing_readiness. They coexist.
  assert.ok(!PROC.includes("'billing_readiness'"), "0078 must not seed billing_readiness rows");
});

test("procedure prerequisites resolve order_note_signature semantically (signed only)", () => {
  const rules = readFileSync(join(ROOT, "server/services/procedureLifecycle/procedurePrerequisiteRules.ts"), "utf8");
  assert.match(rules, /currentOrderNoteSigned/);
  assert.match(rules, /order_note_signature/);
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS  ${r.name}`);
  else { failed++; console.log(`FAIL  ${r.name}\n      ${r.err}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
console.log("Ancillary prerequisite seed QA passed.");
