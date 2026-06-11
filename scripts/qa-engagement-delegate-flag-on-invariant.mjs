// QA: engagement delegate flag-ON invariant (Batch 6).
//
// Source-level proof that when the engagement delegate flag is ON, the
// guarded branch:
//   - calls recordEngagementCallResult
//   - supplies engagementStatusSemantics: "coarse"
//   - supplies callbackHours from admin settings
//   - injects appendJourneyEvent dependency that wraps the canonical writer
//   - injects updateExecutionCaseEngagement dependency
//   - injects upsertTriageCase dependency
//   - injects createFollowUpTask dependency
//   - reconstructs the legacy 6-key response envelope
//   - does NOT touch /api/outreach/calls
//   - does NOT touch Plexus IQ

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

const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);
const src = read(ROUTE) ?? "";

// Extract the delegation branch — between the guard and the
// `return res.json(...)` it ends with.
const guardIdx = src.indexOf("isRecordCallResultEngagementDelegateEnabled()");
if (guardIdx === -1) {
  failures.push(`${ROUTE}: delegate guard not found`);
}
const legacyMarkerIdx = src.indexOf("Legacy code path");
if (legacyMarkerIdx === -1) {
  failures.push(`${ROUTE}: legacy marker not found`);
}
const branch = guardIdx >= 0 && legacyMarkerIdx >= 0 ? src.slice(guardIdx, legacyMarkerIdx) : "";

// §1 — branch calls recordEngagementCallResult.
if (!branch.includes("recordEngagementCallResult(")) {
  failures.push(`${ROUTE}: delegation branch must call recordEngagementCallResult()`);
}

// §2 — coarse engagementStatusSemantics.
if (!branch.includes('engagementStatusSemantics: "coarse"')) {
  failures.push(`${ROUTE}: delegation branch must supply engagementStatusSemantics: "coarse"`);
}

// §3 — callbackHours threaded through.
if (!/callbackHours\s*,/.test(branch)) {
  failures.push(`${ROUTE}: delegation branch must supply callbackHours`);
}

// §4 — each canonical dep is injected.
for (const dep of [
  "appendJourneyEvent:",
  "updateExecutionCaseEngagement:",
  "upsertTriageCase:",
  "createFollowUpTask:",
]) {
  if (!branch.includes(dep)) {
    failures.push(`${ROUTE}: delegation branch must inject ${dep}`);
  }
}

// §5 — each dep wraps the canonical writer (storage.createTask /
// upsertOpenSchedulingTriageCase / appendJourneyEvent / db.update).
for (const writer of [
  "appendJourneyEvent({",
  "upsertOpenSchedulingTriageCase({",
  "storage.createTask({",
  ".update(patientExecutionCases)",
]) {
  if (!branch.includes(writer)) {
    failures.push(`${ROUTE}: delegation branch must wrap canonical writer ${writer}`);
  }
}

// §6 — branch reconstructs the legacy 6-key envelope.
for (const key of [
  "ok: true",
  "executionCase: delegatedExecutionCase",
  "journeyEvent: delegatedJourneyEvent",
  "triageCase: delegatedTriageCase",
  "task: delegatedTask",
  "ownershipUpdated: delegatedOwnershipUpdated",
]) {
  if (!branch.includes(key)) {
    failures.push(`${ROUTE}: delegation branch response envelope missing "${key}"`);
  }
}

// §7 — /api/outreach/calls untouched.
const OUTREACH = "server/routes/outreach.ts";
requireFile(OUTREACH);
const outreachSrc = read(OUTREACH) ?? "";
for (const needle of [
  "isRecordCallResultEngagementDelegateEnabled",
  "recordEngagementCallResult",
  "engagementStatusSemantics",
]) {
  if (outreachSrc.includes(needle)) {
    failures.push(`${OUTREACH}: must remain untouched by engagement delegation`);
  }
}

// §8 — Plexus IQ untouched.
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
      const s = fs.readFileSync(abs, "utf8");
      if (s.includes("recordEngagementCallResult") || s.includes("isRecordCallResultEngagementDelegateEnabled")) {
        failures.push(`Plexus IQ ${rel} references engagement delegation`);
      }
    }
  }
  walk(DIR);
}

if (failures.length > 0) {
  console.error("Engagement delegate flag-ON invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegate flag-ON invariant QA passed.");
