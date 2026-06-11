// QA: outreach delegate dry-run harness (Batch 18).
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

const TEST = "server/services/callResult/__tests__/recordCallResultOutreachDelegateDryRun.test.ts";
requireFile(TEST);
requireText(TEST, [
  "recordOutreachCallResult",
  "isRecordCallResultOutreachDelegateEnabled",
  "CALL_RESULT_PARITY_FIXTURE",
  "OUTREACH_CALL_RESULT_RESPONSE_CONTRACT",
  "makeCapturingOutreachDeps",
]);

// Historical note: Batch B7 of Phase 1 run has since wired the outreach
// route behind the delegate flag. Wiring + safeguards pinned by
// qa-record-call-result-outreach-delegation.mjs.
if (false)
{
  const ROOTS = ["server/routes"];
  const RE = /USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE|isRecordCallResultOutreachDelegateEnabled/;
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
      if (RE.test(src)) failures.push(`Premature route wiring: ${rel} references the outreach delegate flag — Batch 19 has not shipped yet`);
    }
  }
  walk(path.join(root, "server/routes"));
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Outreach delegate dry-run test FAILED"); }
}

if (failures.length > 0) {
  console.error("Outreach delegate dry-run QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach delegate dry-run QA passed.");
