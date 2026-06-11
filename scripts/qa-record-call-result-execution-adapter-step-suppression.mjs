// QA: execution adapter step suppression (Batch A of adapter blockers run).
//
// Asserts the adapter exposes suppressedSteps + a grep-stable
// "surface does not own" reason; runs the adapter test (which now
// includes §10 + §11 suppression cases); pins the no-route-wiring
// invariant.

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

const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
requireFile(ADAPTER);
requireText(ADAPTER, [
  "suppressedSteps",
  "SUPPRESSED_STEP_REASON",
  '"surface does not own"',
  "Per-surface step suppression",
]);

const TEST = "server/services/callResult/__tests__/recordCallResultExecutionAdapter.test.ts";
requireFile(TEST);
requireText(TEST, [
  "suppressedSteps",
  "surface does not own",
  '"outreachCallCreated"',
  '"assignmentCompleted"',
  "suppression does not fail",
]);

// Designated route consumer is server/routes/executionCases.ts
// (Batch 3 of Engagement completion run) — it imports adapter TYPES
// for the dep closures it supplies to the engagement executor.
{
  const ROUTES_DIR = path.join(root, "server/routes");
  const ALLOWED_ROUTE = "server/routes/executionCases.ts";
  const IMPORT_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResultExecutionAdapter(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (rel === ALLOWED_ROUTE) continue;
      if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (IMPORT_RE.test(src)) {
        failures.push(`Route ${rel} unauthorized importer of execution adapter`);
      }
    }
  }
  walk(ROUTES_DIR);
}

// Pin: no Plexus IQ file imports the adapter.
{
  const PLEXUS_DIR = path.join(root, "server/services/plexusIq");
  const IMPORT_RE =
    /(?:from|import)\s+['"][^'"]*\/recordCallResultExecutionAdapter(?:\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx))?['"]/;
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
      if (IMPORT_RE.test(src)) {
        failures.push(`Plexus IQ file ${rel} imports execution adapter — Plexus IQ remains read-model`);
      }
    }
  }
  walk(PLEXUS_DIR);
}

if (failures.length === 0) {
  try {
    execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    failures.push("Adapter test FAILED — suppression cases did not pass");
  }
}

if (failures.length > 0) {
  console.error("Execution adapter step suppression QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Execution adapter step suppression QA passed.");
