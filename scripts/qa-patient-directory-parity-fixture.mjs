// QA: Patient Directory parity fixture (Bundle 21).
//
// Two-layer check:
//   1. Source-code invariants — the parity-fixture test pins the
//      canonical-id derivation rule (lower(trim(name)) + "|" + dob,
//      then sha256 hex) and the freshest-screening-wins demographic
//      selection. The fixture is PHI-free.
//   2. Runs the parity-fixture test via tsx (no DB, no network).
//
// No DB. No app boot. No network. No PHI.

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

const TEST_REL = "server/modules/patient-directory/__tests__/parity-fixture.test.ts";
const CONTRACTS_REL = "server/modules/patient-directory/contracts.ts";
const REPO_REL = "server/modules/patient-directory/repo.ts";

// 1. Files exist.
requireFile(TEST_REL);
requireFile(CONTRACTS_REL);
requireFile(REPO_REL);

// 2. Test contains the canonical algorithm strings, the §-labels,
//    and the PHI-safe synthetic-name convention.
requireText(TEST_REL, [
  "computeCanonicalPatientId_REFERENCE",
  "projectRowsToCanonical_REFERENCE",
  "sha256",
  // Canonical normalization order: trim() then toLowerCase().
  ".trim().toLowerCase()",
  // PHI-safe fixture convention.
  "Alpha One",
  "555-",
  "@example.test",
  // Section labels.
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
]);

// 3. The repo's canonical-id function still uses the SAME rule the
//    inline reference encodes. If the repo's algorithm ever drifts,
//    this asserts on both sides.
requireText(REPO_REL, [
  "computeCanonicalPatientId",
  "createHash(\"sha256\")",
  ".trim().toLowerCase()",
]);

// 4. The test stays PHI-free at the source level (mirrors the fixture
//    convention asserted at runtime in §6).
requireNotText(
  TEST_REL,
  [
    // Real-shape phone fragments.
    "(555)",
    // PHI-shaped identifier keys.
    "patientName",
    "patientDob",
    "mrn",
    "insurance",
    "diagnosis",
  ],
  "PD parity-fixture test contains a PHI-shaped string",
);

// 5. The test imports the contract types only — no DB, no schema, no
//    repo. The repo imports DB / schema; pulling it into the test
//    would trigger a DB connection at import time.
requireNotText(
  TEST_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "@shared/schema"',
    'from "../repo"',
    'from "../service"',
  ],
  "PD parity-fixture test must not pull DB / schema / repo at import",
);

if (failures.length > 0) {
  console.error("Patient Directory parity fixture QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 6. Run the test. The test is no-DB; tsx loads the .ts directly.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["vitest", "run", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(`Patient Directory parity fixture QA failed (test exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log("Patient Directory parity fixture QA passed.");
