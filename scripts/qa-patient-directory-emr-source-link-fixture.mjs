// QA: Patient Directory EMR source-link fixture (Bundle 42).
//
// Source-code invariants + runs the verdict test via tsx. No DB.
// No app boot. No network. No PHI.

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

const FIXTURE_REL = "tests/fixtures/patientDirectoryEmrSourceLink.fixture.ts";
const TEST_REL = "server/repositories/__tests__/patientDirectoryEmrSourceLink-fixture.test.ts";

requireFile(FIXTURE_REL);
requireFile(TEST_REL);

requireText(FIXTURE_REL, [
  "EMR_VENDOR_IDS_FIXTURE",
  "EmrSourceLinkFixtureRow",
  "PATIENT_DIRECTORY_EMR_SOURCE_LINK_FIXTURE_ROWS",
  // Vendors expected.
  "epic",
  "eclinicalworks",
  "cerner_oracle",
  "athena",
  "nextgen",
  "advancedmd",
  "pcc",
  // Required fields.
  "canonicalPatientId",
  "externalPatientId",
  "matchConfidence",
  "sourceConfidence",
  "lastSyncAt",
  "conflictFlag",
  "manualReviewRequired",
  "facilityId",
  "sourceEmr",
]);

// PHI envelope on the fixture — no real names / emails / phones.
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
  "patient-directory EMR source-link fixture must remain PHI-free",
);

// Test exercises every section.
requireText(TEST_REL, [
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
]);

// Test must not pull DB / schema / repo runtime deps.
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../patient-directory.repo"',
  ],
  "patient-directory EMR source-link test must not pull DB / schema / repo at import",
);

if (failures.length > 0) {
  console.error("Patient Directory EMR source-link fixture QA failed (pre-run):");
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
    `Patient Directory EMR source-link fixture QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("Patient Directory EMR source-link fixture QA passed.");
