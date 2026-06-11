// QA: recordCallResult outreach delegate flag + contract (Batch 17).
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

const FLAG = "server/services/callResult/recordCallResultOutreachDelegateFlag.ts";
requireFile(FLAG);
requireText(FLAG, [
  "isRecordCallResultOutreachDelegateEnabled",
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
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
], "outreach delegate flag accessor must stay pure");

const DOC = "docs/architecture/call-result-outreach-delegation-contract.md";
requireFile(DOC);
requireText(DOC, [
  "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE",
  "default",
  "OFF",
  "preview",
  "executor",
  "byte-equivalent",
  "raw_row",
  "Rollback",
  "STOP",
  "Plexus IQ",
  "Untouched",
]);

// Hard-stop: no runtime file imports the delegate flag yet.
{
  const ROOTS = ["server", "shared", "client", "scripts"];
  const IMPORT_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResultOutreachDelegateFlag(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;
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
      if (rel === "scripts/qa-record-call-result-outreach-delegate-flag.mjs") continue;
      // Batch B7 of Phase 1 — designated route consumer.
      if (rel === "server/routes/outreach.ts") continue;
      if (rel.includes("/__tests__/")) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_RE.test(src)) offenders.push(rel);
    }
  }
  for (const r of ROOTS) walk(path.join(root, r));
  for (const o of offenders) failures.push(`Premature delegation wiring: ${o} imports the outreach delegate flag — Batch 17 ships accessor only`);
}

if (failures.length > 0) {
  console.error("Outreach delegate flag QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach delegate flag QA passed.");
