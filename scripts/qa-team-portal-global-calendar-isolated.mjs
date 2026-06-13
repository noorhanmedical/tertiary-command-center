// QA — Global Calendar maintains its own state isolated from the
// right-rail work queue.
//
// Phase 1.7 contract:
//   - TeamPortalShell holds a separate `globalCalendarDate` state.
//   - The left-rail LeftRailCompactCalendar binds to globalCalendarDate
//     (NOT selectedDate).
//   - The expand-to-canvas handler uses globalCalendarDate for the
//     title.
//   - The right-rail feed query keys (team-workspace-call-list /
//     -clinic-schedule / -ancillary-schedule) do NOT include
//     globalCalendarDate.
//
// Run: node scripts/qa-team-portal-global-calendar-isolated.mjs

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
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const shell = "client/src/components/portal/TeamPortalShell.tsx";

requireText(shell, [
  "GLOBAL CALENDAR ISOLATION",
  "globalCalendarDate",
  "setGlobalCalendarDate",
  // The Compact Global Calendar binds to globalCalendarDate.
  "selectedDate={globalCalendarDate}",
  "onSelectDate={(d) => setGlobalCalendarDate(d)}",
  // The expand handler title uses globalCalendarDate.
  "`Calendar — ${globalCalendarDate}`",
]);

// The right-rail feed query keys must NOT include globalCalendarDate.
const src = read(shell) ?? "";
const callListKey = /"team-workspace-call-list"[\s\S]{0,200}\]/.exec(src);
const clinicKey = /"team-workspace-clinic-schedule"[\s\S]{0,200}\]/.exec(src);
const ancillaryKey = /"team-workspace-ancillary-schedule"[\s\S]{0,200}\]/.exec(src);
for (const [m, label] of [
  [callListKey, "team-workspace-call-list"],
  [clinicKey, "team-workspace-clinic-schedule"],
  [ancillaryKey, "team-workspace-ancillary-schedule"],
]) {
  if (!m) {
    failures.push(`Could not locate ${label} query key`);
    continue;
  }
  if (m[0].includes("globalCalendarDate")) {
    failures.push(`${label} query key must NOT include globalCalendarDate (would break isolation)`);
  }
}

if (failures.length > 0) {
  console.error("Global Calendar isolation QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Global Calendar isolation QA passed.");
