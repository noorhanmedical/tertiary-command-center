// QA: shadow-read parity-log analyzer (Bundle 16).
//
// Source-code invariant check + analyzer smoke-test on a PHI-free
// fixture log file. No DB. No app boot. No network. No live logs.
//
// Asserts:
//   1. Analyzer + fixture + QA wrapper files exist.
//   2. Analyzer source contains the load-bearing strings the
//      shadow-read-parity-log-analyzer-design.md doc binds.
//   3. Analyzer does NOT import the DB, the schema, the projection
//      service, or any runtime route module — it is a pure log
//      parser per design §7.1.
//   4. Fixture contains only PHI-free synthetic content.
//   5. Running the analyzer against the fixture emits the EXACT
//      expected day verdicts and overall-window verdict.
//
// Pattern intentionally mirrors scripts/qa-shadow-read-parity-log-schema.mjs.

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

const ANALYZER_REL = "scripts/parity-log-analyzer.mjs";
const FIXTURE_REL = "scripts/fixtures/shadow-read-parity-7d.log";
const DESIGN_REL =
  "docs/architecture/shadow-read-parity-log-analyzer-design.md";

// 1. Files exist.
requireFile(ANALYZER_REL);
requireFile(FIXTURE_REL);
requireFile(DESIGN_REL);

// 2. Analyzer source pins the canonical contract strings.
requireText(ANALYZER_REL, [
  "[USE_OPERATIONAL_QUEUE_CALL_LIST]",
  "shadow-read",
  "parityMatch",
  "legacyCount",
  "queueCount",
  "inLegacyOnly",
  "inQueueOnly",
  "patientName",
  "patientDob",
  "mrn",
  "insurance",
  "diagnosis",
  // Verdict labels the staging gate references.
  "pass",
  "fail",
  // PHI envelope.
  "FORBIDDEN_IDENTIFIERS",
]);

// 3. Analyzer is pure — no DB / schema / route / service imports.
requireNotText(
  ANALYZER_REL,
  [
    'from "../server',
    'from "../shared',
    'from "@shared/schema"',
    "drizzle-orm",
    "pg-pool",
    // Live-staging IO is explicitly out per design §7.
    "https://",
    "fetch(",
  ],
  "analyzer must stay pure (no DB / schema / route / live-staging deps)",
);

// 4. Fixture contains only PHI-free synthetic content.
requireNotText(
  FIXTURE_REL,
  [
    "patientName",
    "patientDob",
    "mrn",
    "insurance",
    "diagnosis",
    "summary:",
    // PHI-name shapes worth banning to keep the fixture sterile.
    "John",
    "Jane",
    "@",
  ],
  "fixture must remain PHI-free synthetic content",
);
// And the fixture must use the canonical prefix so the analyzer
// exercises the real schema, not a sandbox shape.
requireText(FIXTURE_REL, ["[USE_OPERATIONAL_QUEUE_CALL_LIST] shadow-read"]);

if (failures.length > 0) {
  console.error("Shadow-read parity-log analyzer QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 5. Smoke-test: run the analyzer against the fixture and assert the
//    output matches the expected verdicts.
const result = spawnSync(
  "node",
  [path.join(root, ANALYZER_REL), path.join(root, FIXTURE_REL)],
  {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  },
);

// Expected window verdict for the fixture:
//   06-12 pass  (4 success, all match)
//   06-13 fail  (drift 0.0183 >= 0.001)
//   06-14 pass  (2 success match, 1 skip)
//   06-15 fail  (1 error)
//   06-17 pass  (2 success match)
//   06-18 pass  (drift 0.0003 < 0.001)
// window=6d  pass=4  fail=2  skip=0  overall=fail
// exit code 1 (overall=fail)
const expectedExit = 1;
const expectedSubstrings = [
  "day=2026-06-12",
  "verdict=pass",
  "day=2026-06-13",
  "fail (drift>=0.001)",
  "day=2026-06-14",
  "day=2026-06-15",
  "fail (errors>0)",
  "day=2026-06-17",
  "day=2026-06-18",
  "window=6d",
  "pass=4",
  "fail=2",
  "skip=0",
  "overall=fail",
];

const runFailures = [];
if (result.status !== expectedExit) {
  runFailures.push(
    `analyzer exit code: expected ${expectedExit}, got ${result.status}`,
  );
}
const stdout = result.stdout ?? "";
for (const needle of expectedSubstrings) {
  if (!stdout.includes(needle)) {
    runFailures.push(`analyzer stdout missing: "${needle}"`);
  }
}

// PHI envelope at the analyzer-output level: the stdout MUST NOT
// contain any prohibited identifier even if it shows up in tripwire
// lines. Tripwires emit `<redacted>` markers, not raw payloads.
for (const needle of ["patientName", "patientDob", "mrn", "insurance", "diagnosis"]) {
  if (stdout.includes(needle)) {
    runFailures.push(`analyzer stdout leaked forbidden identifier "${needle}"`);
  }
}

if (runFailures.length > 0) {
  console.error("Shadow-read parity-log analyzer QA failed (run):");
  for (const f of runFailures) console.error(`- ${f}`);
  console.error("--- analyzer stdout ---");
  console.error(stdout);
  console.error("--- analyzer stderr ---");
  console.error(result.stderr ?? "");
  process.exit(1);
}

console.log("Shadow-read parity-log analyzer QA passed.");
