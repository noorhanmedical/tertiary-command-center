// QA: recordCallResult execution adapter dormancy + purity invariant
// (Batch H Step 5A).
//
// Source-code invariant pinning the new dependency-injected adapter
// at server/services/callResult/recordCallResultExecutionAdapter.ts.
//
// What this asserts:
//   1. The adapter file exists at the canonical path.
//   2. The adapter imports the canonical recordCallResult planner.
//   3. The adapter is pure — no DB, no Express, no drizzle, no
//      schema runtime, no route import, no storage import, no
//      journey-event writer.
//   4. The adapter does not log PHI (no console.* anywhere; the
//      adapter surfaces failures via the result object only).
//   5. The fake-deps test file exists at the canonical path.
//   6. The test references every pinned fixture outcome by name AND
//      every dependency in the contract.
//   7. The adapter is DORMANT — no non-test runtime file imports it.
//   8. Runs the fake-deps parity test via tsx and asserts exit 0.
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

// 1. Adapter file present.
const ADAPTER_REL = "server/services/callResult/recordCallResultExecutionAdapter.ts";
requireFile(ADAPTER_REL);
requireText(ADAPTER_REL, [
  "export async function executeRecordCallResult",
  "CallResultExecutionDependencies",
  "RecordCallResultExecutionResult",
  "CALL_RESULT_EXECUTION_STEPS",
  "createOutreachCall",
  "appendJourneyEvent",
  "updateAppointmentStatus",
  "updateExecutionCaseEngagement",
  "markAssignmentCompleted",
  "upsertTriageCase",
  "createFollowUpTask",
  "best-effort",
  "strict",
]);

// 2. Adapter imports the canonical planner (sibling specifier).
{
  const c = read(ADAPTER_REL) ?? "";
  if (!/from\s+['"]\.\/recordCallResult['"]/.test(c)) {
    failures.push(
      `${ADAPTER_REL}: adapter must import the canonical planner via the sibling specifier`,
    );
  }
}

// 3. Purity.
requireNotText(
  ADAPTER_REL,
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
    'from "../journey/appendJourneyEvent"',
    'from "../../services/journey/appendJourneyEvent"',
    'from "../outreachService"',
  ],
  "adapter must stay pure (no DB / Express / route / storage imports)",
);

// 4. No console logging or PHI fields.
requireNotText(
  ADAPTER_REL,
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
  "adapter must not log or accept PHI",
);

// 5. Test file present.
const TEST_REL = "server/services/callResult/__tests__/recordCallResultExecutionAdapter.test.ts";
requireFile(TEST_REL);

// 6. Test references every pinned outcome + every dependency.
requireText(TEST_REL, [
  "CALL_RESULT_OUTCOMES_FIXTURE",
  "CALL_RESULT_PARITY_FIXTURE",
  "executeRecordCallResult",
  "CALL_RESULT_EXECUTION_STEPS",
  // Outcomes by name.
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
  // Every dependency surfaces in the test.
  "createOutreachCall",
  "appendJourneyEvent",
  "updateAppointmentStatus",
  "updateExecutionCaseEngagement",
  "markAssignmentCompleted",
  "upsertTriageCase",
  "createFollowUpTask",
  // Failure path is exercised.
  "simulated upsert failure",
  "strict",
]);

// 7. Dormancy — no non-test runtime file imports the adapter.
{
  const ROOTS = ["server", "shared", "client", "scripts"];
  const offenders = [];

  // Match imports ending at the exact specifier
  // ".../recordCallResultExecutionAdapter" (optional extension).
  const IMPORT_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResultExecutionAdapter(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === ".next" ||
        e.name === "build"
      ) {
        continue;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (rel === ADAPTER_REL) continue;
      if (rel === TEST_REL) continue;
      if (rel.startsWith("scripts/qa-record-call-result-execution-adapter.mjs")) continue;
      if (rel.includes("/__tests__/")) continue;
      if (rel.includes("/test/") || rel.includes("/tests/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      // Designated dormant wrappers around the adapter (Batches 7 + 14).
      if (rel === "server/services/callResult/recordCallResultEngagementExecutor.ts") continue;
      if (rel === "server/services/callResult/recordCallResultOutreachExecutor.ts") continue;

      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_RE.test(src)) {
        offenders.push(rel);
      }
    }
  }

  for (const r of ROOTS) walk(path.join(root, r));

  if (offenders.length > 0) {
    for (const o of offenders) {
      failures.push(
        `Dormancy violation: ${o} imports recordCallResultExecutionAdapter — adapter must not be wired to runtime yet (Batch H Step 5A hard-stop)`,
      );
    }
  }
}

// 8. Run the fake-deps parity test via tsx.
if (failures.length === 0) {
  try {
    execSync(`npx tsx ${TEST_REL}`, {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (_e) {
    failures.push("recordCallResult execution adapter test FAILED — see output above");
  }
}

if (failures.length > 0) {
  console.error("recordCallResult execution adapter QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("recordCallResult execution adapter QA passed.");
