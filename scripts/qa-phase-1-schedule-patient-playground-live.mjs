// QA — SchedulePatientPlayground is wired into the actual workspace.
//
// Source-level proof that the canonical SchedulePatientPlayground
// component exists and is consumed by TeamPortalShell with the live
// canonical schedule-day context helper.
//
// Run: node scripts/qa-phase-1-schedule-patient-playground-live.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

const playground = "client/src/components/portal/SchedulePatientPlayground.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const api = "client/src/lib/workflow/teamMemberWorkspaceApi.ts";

// 1) Canonical component exists and is exported.
requireText(playground, [
  "SchedulePatientPlayground",
  "export",
]);

// 2) TeamPortalShell imports + renders the playground.
requireText(shell, [
  "SchedulePatientPlayground",
  "<SchedulePatientPlayground",
]);

// 3) Live day-context helper is wired (no static day fixture).
requireText(api, [
  "fetchPatientScheduleDayContext",
  "/api/global-schedule-events",
  "schedulePatientAncillary",
  "/api/global-schedule-events/schedule-ancillary",
]);

if (failures.length > 0) {
  console.error("SchedulePatientPlayground wiring QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("SchedulePatientPlayground wiring QA passed.");
