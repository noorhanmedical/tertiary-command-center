// QA: Plexus IQ aggregate read forwarding (Bundle 52).
//
// Source-code invariant + runs the forwarding test via tsx.
//
// Asserts:
//   1. The fixture + test exist.
//   2. The fixture pins every Bundle 25 §3 field name in the
//      patient_screenings forward slice.
//   3. The fixture pins the canonical reasoning blob keys
//      (per-ancillary + adminReview:<id> namespaces).
//   4. PHI envelope at the fixture-source level.
//   5. The test does not pull DB / schema / service deps.
//
// Source-code invariant + smoke run. No DB. No app boot. No
// network. No PHI.

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

const FIXTURE_REL = "tests/fixtures/plexusIqAggregateRead.fixture.ts";
const TEST_REL = "server/modules/plexus-iq/__tests__/aggregate-read-forwarding.test.ts";

requireFile(FIXTURE_REL);
requireFile(TEST_REL);

// 1. Fixture pins every Bundle 25 §3.1 patient_screenings field
//    so a future PR cannot silently drop one from the contract.
requireText(FIXTURE_REL, [
  // Identity.
  "name:",
  "dob:",
  "phoneNumber:",
  "email:",
  "facility:",
  "patientType:",
  // Commit state.
  "commitStatus:",
  "committedAt:",
  "committedByUserId:",
  // Admin approval state.
  "adminApprovalStatus:",
  "adminApprovedAt:",
  "adminApprovedByUserId:",
  "adminApprovalNote:",
  // Qualification arrays.
  "qualifyingTests:",
  "cooldownTests:",
  // Canonical reasoning.
  "reasoning:",
  // Ancillaries the modal renders.
  "brainwave",
  "vitalwave",
  "ultrasound",
  // Admin Review supplemental metadata namespace.
  "adminReview:brainwave",
  "adminReview:vitalwave",
  // Execution case forward slice.
  "engagementStatus:",
  "engagementBucket:",
  "assignedTeamMemberId:",
  // Evidence forward slice.
  "ruleEngineVersion:",
  "candidateIcds:",
  "evidenceSnapshot:",
]);

// 2. Reference forwarder export.
requireText(FIXTURE_REL, [
  "forwardLegacySlicesToAggregate_REFERENCE",
]);

// 3. PHI envelope at the fixture-source level.
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
    "Doe ",
  ],
  "plexus-iq aggregate fixture must remain PHI-free",
);

// 4. Test exercises every section.
requireText(TEST_REL, [
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
  "§7",
]);

// 5. Test does not pull DB / schema / service deps.
requireNotText(
  TEST_REL,
  [
    'from "../../../../db"',
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../../services/plexusIq"',
    'from "../service"',
  ],
  "plexus-iq aggregate forwarding test must not pull DB / schema / service at import",
);

if (failures.length > 0) {
  console.error("Plexus IQ aggregate read forwarding QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 6. Run the forwarding test.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["vitest", "run", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    `Plexus IQ aggregate read forwarding QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("Plexus IQ aggregate read forwarding QA passed.");
