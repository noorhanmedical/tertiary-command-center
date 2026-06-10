// QA: ancillary qualification evidence fixture (Bundle 41).
//
// Source-code invariants + runs the fixture verdict test via tsx.
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

const FIXTURE_REL = "tests/fixtures/ancillaryQualificationEvidence.fixture.ts";
const TEST_REL = "server/repositories/__tests__/ancillaryQualificationEvidence-fixture.test.ts";

requireFile(FIXTURE_REL);
requireFile(TEST_REL);

// 1. The fixture pins the canonical ancillary names + the §11
//    envelope keys + the review-status set.
requireText(FIXTURE_REL, [
  "ANCILLARY_NAMES_FIXTURE",
  "brainwave",
  "vitalwave",
  "ultrasound",
  "future_ancillary_a",
  // Envelope keys.
  "suggestionId",
  "suggestedStatus",
  "supportingEvidence",
  "missingEvidence",
  "exclusions",
  "sourceReferences",
  "confidence",
  "reviewStatus",
  "humanApprovalRequired",
  // Status enums.
  "qualified",
  "not_qualified",
  "needs_more_evidence",
  "excluded",
  "unreviewed",
  "clinician_accepted",
  "clinician_rejected",
  "admin_overridden",
]);

// 2. PHI envelope — no PHI-shaped strings used as object keys or
//    as real-shape identifiers. The fixture is permitted to NAME
//    forbidden identifiers in its own runtime guard list (and in
//    the doc comment); the check below detects actual usage as
//    object/type keys via the `<key>:` pattern, matching the
//    Bundle 28 / Bundle 21 pattern.
{
  const c = read(FIXTURE_REL) ?? "";
  const phiKeys = [
    "patientName",
    "patientDob",
    "mrn",
    "insurance",
    "diagnosis",
  ];
  for (const k of phiKeys) {
    const re = new RegExp(`(^|[^A-Za-z0-9_"\\\\])${k}\\s*:`, "g");
    if (re.test(c)) {
      failures.push(
        `ancillary qualification fixture uses PHI-shaped key "${k}" as an object/type field`,
      );
    }
  }
  // Real-shape identifiers cannot appear anywhere — these are not
  // valid even inside guard lists since they would be the actual
  // shape of leaked PHI.
  for (const realShape of ["John ", "Jane ", "Smith ", "@gmail", "@hotmail", "(555)"]) {
    if (c.includes(realShape)) {
      failures.push(
        `ancillary qualification fixture contains real-shape identifier "${realShape}"`,
      );
    }
  }
}

// 3. Test must not pull DB / schema / repo runtime deps.
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../billingReadiness.repo"',
  ],
  "ancillary qualification fixture test must not pull DB / schema / repo at import",
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
  "§8",
  "§9",
]);

if (failures.length > 0) {
  console.error("Ancillary qualification evidence fixture QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 5. Run the fixture verdict test.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["tsx", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    `Ancillary qualification evidence fixture QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("Ancillary qualification evidence fixture QA passed.");
