// QA: engagementStatusSemantics option (Batch 1 of Engagement completion run).
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

const ADAPTER = "server/services/callResult/recordCallResultExecutionAdapter.ts";
requireFile(ADAPTER);
requireText(ADAPTER, [
  'engagementStatusSemantics?: "coarse" | "canonical"',
  '"coarse"',
  '"canonical"',
  '!rawPlan.terminal',
  '"in_progress" as const',
]);

const ADAPTER_TEST = "server/services/callResult/__tests__/recordCallResultExecutionAdapter.test.ts";
requireFile(ADAPTER_TEST);
requireText(ADAPTER_TEST, [
  "§16",
  "§16.default",
  "§16.canonical",
  "§16.coarse",
  '§16.coarse terminal',
  '§16.coarse declined',
]);

const EXEC_TEST = "server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts";
requireFile(EXEC_TEST);
requireText(EXEC_TEST, ["§3.16", "engagementStatusSemantics"]);

// Batch 3 of this run wires the engagement route. The Batch 1 QA
// originally asserted the route was un-delegated; we now just check
// the route file exists. The wiring + safeguards are pinned by
// qa-record-call-result-engagement-delegation.mjs.
const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);

// Pin: no client/src file edited.
{
  const ROOTS = ["client/src"];
  function walk(dir, results) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs, results); continue; }
      if (!/\.(ts|tsx|mts|cts|js|jsx)$/.test(e.name)) continue;
      results.push(abs);
    }
  }
  const files = [];
  for (const r of ROOTS) walk(path.join(root, r), files);
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes("engagementStatusSemantics")) {
      failures.push(`Client file ${path.relative(root, abs)} references engagementStatusSemantics — Batch 1 does not change UI`);
    }
  }
}

// Pin: no Plexus IQ file touched.
{
  const DIR = path.join(root, "server/services/plexusIq");
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      const src = fs.readFileSync(abs, "utf8");
      if (src.includes("engagementStatusSemantics")) {
        failures.push(`Plexus IQ ${rel} references engagementStatusSemantics — must remain read-model`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("engagementStatusSemantics option QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("engagementStatusSemantics option QA passed.");
