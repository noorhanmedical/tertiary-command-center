// QA: outreach executor step suppression (Batch C).

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

const EXEC = "server/services/callResult/recordCallResultOutreachExecutor.ts";
requireFile(EXEC);
requireText(EXEC, [
  "OUTREACH_SUPPRESSED_STEPS",
  '"journeyEventAppended"',
  '"executionCaseUpdated"',
  '"triageCaseUpserted"',
  '"followUpTaskCreated"',
  "suppressedSteps: mergedSuppressed",
]);

const TEST = "server/services/callResult/__tests__/recordCallResultOutreachExecutor.test.ts";
requireFile(TEST);
requireText(TEST, [
  "OUTREACH_SUPPRESSED_STEPS",
  "skipped on outreach",
  "surface does not own",
]);

const DRY = "server/services/callResult/__tests__/recordCallResultOutreachDelegateDryRun.test.ts";
requireFile(DRY);
requireText(DRY, [
  "OUTREACH_SUPPRESSED_STEPS",
  "skipped on outreach",
  "surface does not own",
]);

// Pin: no route wires the outreach executor.
{
  const ROUTES = path.join(root, "server/routes");
  const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultOutreachExecutor(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Route ${rel} imports outreach executor — Batch C does NOT wire routes`);
    }
  }
  walk(ROUTES);
}

// Pin: no Plexus IQ file imports the outreach executor.
{
  const DIR = path.join(root, "server/services/plexusIq");
  const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultOutreachExecutor(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Plexus IQ ${rel} imports outreach executor — must remain read-model`);
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Outreach step suppression QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach step suppression QA passed.");
