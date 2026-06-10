// QA: Patient Directory shadow-read parity fixture (Bundle 48).
//
// Source-code invariants + runs the verdict test via tsx. No DB,
// no app boot, no network, no PHI.

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

const FIXTURE_REL = "tests/fixtures/patientDirectoryShadowRead.fixture.ts";
const TEST_REL = "server/repositories/__tests__/patientDirectoryShadowRead-fixture.test.ts";

requireFile(FIXTURE_REL);
requireFile(TEST_REL);

requireText(FIXTURE_REL, [
  // Verdict enum.
  "SHADOW_READ_PARITY_VERDICTS",
  "match",
  "drift_minor",
  "drift_major",
  "conflict",
  "not_resolvable",
  // Fixture identifiers + envelope keys.
  "PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS",
  "FIXTURE_CASE_MATCH",
  "FIXTURE_CASE_DRIFT_MINOR",
  "FIXTURE_CASE_DRIFT_MAJOR",
  "FIXTURE_CASE_CONFLICT",
  "FIXTURE_CASE_NOT_RESOLVABLE",
  "deriveShadowReadVerdict_REFERENCE",
  "parityMatch",
  "fieldsCompared",
  "fieldsDivergent",
  "manualReviewRequired",
  "conflictFlag",
  // Identity fields.
  "canonicalPatientId" ? "canonicalPatientId" : "id",
  "primaryScreeningId",
  "externalPatientId",
  "mrn",
]);

// PHI envelope. The fixture must use synthetic-only identifiers.
requireNotText(
  FIXTURE_REL,
  [
    "@gmail",
    "@hotmail",
    "@yahoo",
    "(555)",
    "John ",
    "Jane ",
    "Smith ",
    "diagnosis",
    "insurance",
  ],
  "patient-directory shadow-read fixture must remain PHI-free",
);

requireText(TEST_REL, [
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
  "§7",
]);
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../../modules/patient-directory/repo"',
    'from "../../modules/patient-directory/service"',
  ],
  "patient-directory shadow-read test must not pull DB / schema / repo at import",
);

if (failures.length > 0) {
  console.error("Patient Directory shadow-read fixture QA failed (pre-run):");
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
  console.error(
    `Patient Directory shadow-read fixture QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("Patient Directory shadow-read fixture QA passed.");
