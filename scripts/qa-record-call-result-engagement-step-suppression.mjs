// QA: engagement executor step suppression (Batch B).

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

const EXEC = "server/services/callResult/recordCallResultEngagementExecutor.ts";
requireFile(EXEC);
requireText(EXEC, [
  "ENGAGEMENT_SUPPRESSED_STEPS",
  '"outreachCallCreated"',
  '"assignmentCompleted"',
  "suppressedSteps: mergedSuppressed",
]);

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(TEST);
requireText(TEST, [
  "ENGAGEMENT_SUPPRESSED_STEPS",
  "surface does not own",
  "suppressed on engagement surface",
]);

const DRY = "server/services/callResult/__tests__/recordCallResultEngagementDelegateDryRun.test.ts";
requireFile(DRY);
requireText(DRY, [
  "skipped on engagement",
  "surface does not own",
]);

// Pin: no route wires the engagement executor yet.
{
  const ROUTES = path.join(root, "server/routes");
  const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultEngagementExecutor(?:\.\w+)?['"]/;
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
      if (RE.test(src)) failures.push(`Route ${rel} imports engagement executor — Batch B does NOT wire routes`);
    }
  }
  walk(ROUTES);
}

// Pin: no Plexus IQ file imports the engagement executor.
{
  const DIR = path.join(root, "server/services/plexusIq");
  const RE = /(?:from|import)\s+['"][^'"]*\/recordCallResultEngagementExecutor(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Plexus IQ ${rel} imports engagement executor — must remain read-model`);
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Engagement step suppression QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement step suppression QA passed.");
