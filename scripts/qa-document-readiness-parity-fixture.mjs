// QA: Document / report readiness parity fixture (Bundle 26).
//
// Source-code invariant + runs the parity test via tsx. No DB, no
// app boot, no network, no PHI.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

const FIXTURE_REL = "tests/fixtures/documentReadiness.fixture.ts";
const TEST_REL = "server/repositories/__tests__/documentReadiness-parity.test.ts";
const REPO_REL = "server/repositories/billingReadiness.repo.ts";

requireFile(FIXTURE_REL);
requireFile(TEST_REL);
requireFile(REPO_REL);

// Fixture pins the canonical required doc types + passing statuses.
requireText(FIXTURE_REL, [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
  // Passing statuses must remain in the canonical set.
  "completed",
  "uploaded",
  "approved",
  "generated",
  "REQUIRED_DOC_TYPES",
  "PASSING_STATUSES_BY_TYPE",
]);

// Fixture is PHI-free.
requireNotText(
  FIXTURE_REL,
  ["patientName", "patientDob", "mrn", "insurance", "diagnosis", "@gmail", "@hotmail"],
  "documentReadiness fixture must remain PHI-free",
);

// Test pins the verdict shape.
requireText(TEST_REL, [
  "evaluateReadiness_REFERENCE",
  "ready_to_generate",
  "missing_requirements",
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
  "§7",
]);

// Test must not import DB / schema / repo at module load.
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../billingReadiness.repo"',
    'from "../documentReadiness.repo"',
  ],
  "documentReadiness parity test must not pull DB / schema / repo at import",
);

// Repo file still uses REQUIRED_DOC_RULES — the legacy evaluator
// the fixture mirrors. If a future refactor moves the rules, both
// the fixture and this assertion need an update.
requireText(REPO_REL, ["REQUIRED_DOC_RULES", "informed_consent", "report"]);

if (failures.length > 0) {
  console.error("Document readiness parity fixture QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["tsx", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(`Document readiness parity QA failed (test exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log("Document readiness parity fixture QA passed.");
