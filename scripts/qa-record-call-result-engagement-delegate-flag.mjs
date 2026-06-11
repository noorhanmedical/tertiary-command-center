// QA: recordCallResult engagement delegate flag + contract (Batch 10).
import fs from "node:fs";
import path from "node:path";

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
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const FLAG = "server/services/callResult/recordCallResultEngagementDelegateFlag.ts";
requireFile(FLAG);
requireText(FLAG, [
  "isRecordCallResultEngagementDelegateEnabled",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  '"1"',
  '"true"',
  '"yes"',
]);
requireNotText(FLAG, [
  'from "../../db"',
  'from "../../../db"',
  'from "express"',
  'from "@shared/schema"',
  'from "drizzle-orm"',
  'from "../storage"',
  'from "../../storage"',
  'from "../routes/',
  "console.log",
  "console.info",
], "engagement delegate flag accessor must stay pure");

const DOC = "docs/architecture/call-result-engagement-delegation-contract.md";
requireFile(DOC);
requireText(DOC, [
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
  "default",
  "OFF",
  "preview",
  "executor",
  "byte-equivalent",
  "Rollback",
  "STOP",
  "Plexus IQ",
  "Untouched",
]);

// Historical note: Batch 10 of split-brain run shipped only the
// accessor; Batch 11 allowed a test importer; Batch 3 of the
// Engagement completion run has since wired the engagement route
// behind a default-OFF flag. The runtime importer policy is:
//   - server/routes/executionCases.ts (the designated route consumer)
//   - tests / harness files anywhere
// Anything else still trips the QA.
{
  const ROOTS = ["server", "shared", "client", "scripts"];
  const IMPORT_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResultEngagementDelegateFlag(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;
  const ALLOWED = new Set([
    "server/routes/executionCases.ts",
  ]);
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
      if (rel === FLAG) continue;
      if (rel === "scripts/qa-record-call-result-engagement-delegate-flag.mjs") continue;
      if (ALLOWED.has(rel)) continue;
      if (rel.includes("/__tests__/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_RE.test(src)) offenders.push(rel);
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
  for (const o of offenders) {
    failures.push(`Unauthorized importer: ${o} imports the engagement delegate flag — only the designated route may`);
  }
}

if (failures.length > 0) {
  console.error("Engagement delegate flag QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegate flag QA passed.");
