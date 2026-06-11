// QA: engagement delegate dry-run harness (Batch 11 of split-brain run).
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
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementDelegateDryRun.test.ts";
requireFile(TEST);
requireText(TEST, [
  "recordEngagementCallResult",
  "isRecordCallResultEngagementDelegateEnabled",
  "CALL_RESULT_PARITY_FIXTURE",
  "ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS",
  "makeCapturingDeps",
  "ownershipUpdated",
  "executionCase",
  "journeyEvent",
  "triageCase",
  "task",
]);

// Assert no route reads the flag yet (Batch 11 ships only the harness).
{
  const ROOTS = ["server/routes"];
  const RE = /USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE|isRecordCallResultEngagementDelegateEnabled/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (["node_modules", "dist"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) {
        failures.push(`Premature route wiring: ${rel} references the engagement delegate flag — Batch 12 has not shipped yet`);
      }
    }
  }
  walk(path.join(root, "server/routes"));
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Engagement delegate dry-run test FAILED"); }
}

if (failures.length > 0) {
  console.error("Engagement delegate dry-run QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegate dry-run QA passed.");
