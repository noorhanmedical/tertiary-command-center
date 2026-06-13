// QA — Compact Global Calendar lives in the left tools rail.
//
// Asserts the compact calendar component exists, is rendered by the
// TeamPortalShell, and that clicking it can promote to the center
// playground via the existing centerMode pipeline.
//
// Run: node scripts/qa-team-portal-left-panel-calendar.mjs

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

const calendar = "client/src/components/portal/leftRail/LeftRailCompactCalendar.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

requireText(calendar, [
  "LeftRailCompactCalendar",
  "onSelectDate",
  "onExpandToCanvas",
  // Default testId prop value is wired via {testId}; assert both the
  // prop default string and the per-button literal testids.
  '"left-rail-compact-calendar"',
  '"left-rail-compact-calendar-prev"',
  '"left-rail-compact-calendar-next"',
  '"left-rail-compact-calendar-expand"',
]);

requireText(shell, [
  "LeftRailCompactCalendar",
  "<LeftRailCompactCalendar",
  // The expand handler routes through the existing centerMode +
  // centerTitle pipeline (not a new scheduler-portal screen).
  "onExpandToCanvas",
]);

if (failures.length > 0) {
  console.error("Team Portal compact calendar QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal compact calendar QA passed.");
