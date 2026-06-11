// QA: recordCallResult engagement-center executor dormancy + purity
// (Batch 7 of split-brain run).

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
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

const SVC = "server/services/callResult/recordCallResultEngagementExecutor.ts";
requireFile(SVC);
requireText(SVC, [
  "recordEngagementCallResult",
  "ENGAGEMENT_OWNED_STEPS",
  "executeRecordCallResult",
  "engagement_center_route",
  "journeyEventAppended",
  "executionCaseUpdated",
  "triageCaseUpserted",
  "followUpTaskCreated",
]);
requireNotText(SVC, [
  'from "../../db"',
  'from "../../../db"',
  'from "drizzle-orm"',
  'from "express"',
  'from "@shared/schema"',
  'from "../../routes/',
  'from "../../storage"',
  'from "../storage"',
  "console.log",
  "console.info",
  "patientName",
  "patientDob",
  "mrn",
  "ssn",
], "engagement executor must stay pure / no PHI");

// Imports the adapter via sibling specifier.
{
  const c = read(SVC) ?? "";
  if (!/from\s+['"]\.\/recordCallResultExecutionAdapter['"]/.test(c)) {
    failures.push(`${SVC}: must import { executeRecordCallResult } from the sibling adapter`);
  }
}

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(TEST);
requireText(TEST, [
  "recordEngagementCallResult",
  "ENGAGEMENT_OWNED_STEPS",
  "CALL_RESULT_PARITY_FIXTURE",
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

// Dormancy — only tests may import the engagement executor.
{
  const ROOTS = ["server", "shared", "client", "scripts"];
  const IMPORT_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResultEngagementExecutor(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;
  const offenders = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist", ".next", "build"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (rel === SVC) continue;
      if (rel === TEST) continue;
      if (rel.startsWith("scripts/qa-record-call-result-engagement-executor.mjs")) continue;
      if (rel.includes("/__tests__/")) continue;
      if (rel.includes("/test/") || rel.includes("/tests/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_RE.test(src)) offenders.push(rel);
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
  for (const o of offenders) {
    failures.push(`Dormancy violation: ${o} imports recordCallResultEngagementExecutor — Batch 7 hard-stop`);
  }
}

// Run the test.
if (failures.length === 0) {
  try {
    execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    failures.push("Engagement executor test FAILED — see output above");
  }
}

if (failures.length > 0) {
  console.error("Engagement executor QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement executor QA passed.");
