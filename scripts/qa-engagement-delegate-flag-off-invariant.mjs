// QA: engagement delegate flag-OFF invariant (Batch 5).
//
// Asserts that when the engagement delegate flag is OFF (which is the
// default), the legacy code path is the one that runs. Source-level
// proof — does NOT execute the route handler.

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

// §1 — Flag accessor defaults OFF (truthy values only enable it).
{
  const FLAG = "server/services/callResult/recordCallResultEngagementDelegateFlag.ts";
  requireFile(FLAG);
  const src = read(FLAG) ?? "";
  for (const needle of [
    "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE",
    'v === "1"',
    'v === "true"',
    'v === "yes"',
  ]) {
    if (!src.includes(needle)) failures.push(`${FLAG}: missing "${needle}"`);
  }
  // No default-truthy fallback.
  if (/return true/.test(src)) failures.push(`${FLAG}: must not return true unconditionally`);
}

// §2 — Route still has the legacy branch intact (proves we did not
//      remove it when adding the delegation branch).
{
  const ROUTE = "server/routes/executionCases.ts";
  requireFile(ROUTE);
  const src = read(ROUTE) ?? "";
  for (const needle of [
    "Legacy code path",
    // Legacy callers still in the route file:
    "appendJourneyEvent({",
    "upsertOpenSchedulingTriageCase({",
    "storage.createTask({",
    ".update(patientExecutionCases)",
    // Legacy response envelope.
    "executionCase: updatedExecutionCase",
  ]) {
    if (!src.includes(needle)) failures.push(`${ROUTE}: legacy code path needle "${needle}" missing`);
  }
}

// §3 — Delegation branch is GUARDED by the flag accessor.
{
  const ROUTE = "server/routes/executionCases.ts";
  const src = read(ROUTE) ?? "";
  if (!/if\s*\(\s*isRecordCallResultEngagementDelegateEnabled\(\)\s*&&/.test(src)) {
    failures.push(`${ROUTE}: delegation branch must be guarded by isRecordCallResultEngagementDelegateEnabled()`);
  }
}

// §4 — No default-ON env behavior anywhere in client/src.
{
  const ROOTS = [path.join(root, "client/src")];
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
  for (const r of ROOTS) walk(r, files);
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes("USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE")) {
      failures.push(`${path.relative(root, abs)} references the engagement delegate env var — UI must not branch on it`);
    }
    if (src.includes("isRecordCallResultEngagementDelegateEnabled")) {
      failures.push(`${path.relative(root, abs)} calls the engagement delegate accessor — UI does not own this`);
    }
  }
}

// §5 — No Plexus IQ file branches on the delegate flag.
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
      if (src.includes("isRecordCallResultEngagementDelegateEnabled")) {
        failures.push(`Plexus IQ ${rel} references the engagement delegate accessor`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Engagement delegate flag-OFF invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegate flag-OFF invariant QA passed.");
