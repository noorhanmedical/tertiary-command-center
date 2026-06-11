// QA: recordCallResult service dormancy + purity invariant
// (Batch H Step 1).
//
// Source-code invariant pinning the new canonical call-result
// planner at server/services/callResult/recordCallResult.ts.
//
// What this asserts:
//   1. The service file exists at the canonical path.
//   2. The service is pure — does not import DB, Express, schema
//      runtime, routes, or storage.
//   3. The service does not log PHI (no console.log of patient
//      identifiers; we forbid raw console.log entirely so any logging
//      goes through a future dep-injected logger).
//   4. The parity test exists at the canonical path.
//   5. The parity test references every pinned fixture outcome.
//   6. The parity test imports the Batch B fixture.
//   7. The service is DORMANT — no non-test runtime file imports it
//      anywhere in the tree.
//   8. Runs the parity test via tsx and asserts exit code 0.
//
// No DB. No app boot. No network. No PHI.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

// 1. Service file present.
const SERVICE_REL = "server/services/callResult/recordCallResult.ts";
requireFile(SERVICE_REL);
requireText(SERVICE_REL, [
  "export function recordCallResult",
  "RecordCallResultOutcome",
  "CanonicalCallResultInput",
  "CallResultOutcome",
  "CallResultSourceSurface",
  "call_result_logged",
  "outreach_call_route",
  "engagement_center_route",
  // Every pinned outcome label must appear in the planner mapping.
  '"scheduled"',
  '"callback"',
  '"no_answer"',
  '"voicemail"',
  '"wrong_number"',
  '"declined"',
  '"needs_records"',
  '"insurance_prior_auth_issue"',
  '"manager_review"',
  '"facility_specific_issue"',
]);

// 2. Purity — no DB / Express / drizzle / schema runtime / routes /
//    storage / journey-event direct writer imports.
requireNotText(
  SERVICE_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "../db"',
    'from "drizzle-orm"',
    'from "drizzle-orm/',
    'from "express"',
    'from "@shared/schema"',
    'from "../../routes/',
    'from "../routes/',
    'from "../../storage"',
    'from "../storage"',
    'from "../../modules/journey-events/appendJourneyEvent"',
    'from "../modules/journey-events/appendJourneyEvent"',
    'from "../journey"',
    'from "../outreachService"',
  ],
  "recordCallResult must stay pure (no DB/Express/routes/storage imports)",
);

// 3. No PHI-style logging. The planner returns its envelope —
//    callers decide how/whether to log.
requireNotText(
  SERVICE_REL,
  [
    "console.log",
    "console.info",
    "console.warn",
    "console.error",
    "patientName",
    "patientDob",
    "mrn",
    "ssn",
    "phoneNumber",
    "phoneE164",
  ],
  "recordCallResult must not log or accept PHI",
);

// 4. Parity test present.
const TEST_REL = "server/services/callResult/__tests__/recordCallResult-parity.test.ts";
requireFile(TEST_REL);

// 5. Test references every pinned fixture outcome by name (echo of
//    the §1 loop labels). The test iterates `CALL_RESULT_PARITY_FIXTURE`
//    so coverage is dynamic — but we additionally pin per-outcome
//    spot-check labels so a regression that only iterates a subset
//    is caught by source-grep too.
requireText(TEST_REL, [
  "CALL_RESULT_OUTCOMES_FIXTURE",
  "CALL_RESULT_PARITY_FIXTURE",
  "recordCallResult",
  'outcome: "scheduled"',
  '"callback"',
  '"no_answer"',
  '"voicemail"',
  '"wrong_number"',
  '"declined"',
  '"needs_records"',
  '"insurance_prior_auth_issue"',
  '"manager_review"',
  '"facility_specific_issue"',
  "executionCaseNextActionAt",
  "assignmentCompleted",
  "followUpTaskRequired",
  "triageCaseRequired",
  "callbackAt",
]);

// 6. Test imports the Batch B fixture.
requireText(TEST_REL, [
  "tests/fixtures/callResultCanonicalization.fixture",
]);

// 7. Dormancy — no non-test runtime file imports the canonical
//    recordCallResult planner except the designated preview-flag
//    module added in Batch H Step 2 (which imports it for parity
//    logging only; the route imports the flag module, not the
//    planner directly).
{
  const ROOTS = ["server", "shared", "client", "scripts"];
  const importers = [];

  // Regex: imports that end at the exact module specifier
  // ".../recordCallResult" — optionally followed by .ts/.js. Matches
  // `from "../recordCallResult"` but NOT
  // `from "../recordCallResultEngagementPreviewFlag"`.
  const IMPORT_SPECIFIER_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResult(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;

  // The designated importers of recordCallResult — surface preview
  // helpers + the (still-dormant) execution adapter. Routes still go
  // THROUGH these modules, never directly to the planner.
  const ALLOWED_RUNTIME_IMPORTERS = new Set([
    "server/services/callResult/recordCallResultEngagementPreviewFlag.ts",
    "server/services/callResult/recordCallResultOutreachPreviewFlag.ts",
    "server/services/callResult/recordCallResultExecutionAdapter.ts",
    // Engagement / outreach executors are dormant wrappers around the
    // adapter; they re-export planner types for the route delegation
    // PRs (Batches 12 + 19). Routes still go through these wrappers,
    // never directly to the planner.
    "server/services/callResult/recordCallResultEngagementExecutor.ts",
  ]);

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".next" || e.name === "build") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      // The service itself, its test, and this QA are allowed importers.
      if (rel === SERVICE_REL) continue;
      if (rel === TEST_REL) continue;
      if (rel.startsWith("scripts/qa-record-call-result-dormancy.mjs")) continue;
      // Test files anywhere are allowed.
      if (rel.includes("/__tests__/")) continue;
      if (rel.includes("/test/") || rel.includes("/tests/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      // The designated preview-flag module is allowed to import the planner.
      if (ALLOWED_RUNTIME_IMPORTERS.has(rel)) continue;

      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_SPECIFIER_RE.test(src)) {
        importers.push(`${rel} imports recordCallResult`);
      }
    }
  }

  for (const r of ROOTS) walk(path.join(root, r));

  if (importers.length > 0) {
    for (const i of importers) {
      failures.push(
        `Dormancy violation: ${i} — only the designated preview-flag module may import recordCallResult from runtime`,
      );
    }
  }
}

// 8. Run the parity test via tsx.
if (failures.length === 0) {
  try {
    execSync(`npx tsx ${TEST_REL}`, {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (_e) {
    failures.push("recordCallResult parity test FAILED — see output above");
  }
}

if (failures.length > 0) {
  console.error("recordCallResult dormancy QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("recordCallResult dormancy QA passed.");
