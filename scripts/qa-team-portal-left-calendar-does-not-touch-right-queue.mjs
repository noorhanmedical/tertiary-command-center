// QA — The left Compact Global Calendar must not mutate any state
// that drives the right-rail queue.
//
// We assert by reading the LeftRailCompactCalendar usage block inside
// TeamPortalShell and verifying:
//   - It does NOT call setSelectedDate.
//   - It does NOT call setFacility.
//   - It does NOT call setSelectedPatientId.
//   - It does NOT call setActiveWorkspaceMode.
//
// Run: node scripts/qa-team-portal-left-calendar-does-not-touch-right-queue.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);

// Extract the LeftRailCompactCalendar usage block: the JSX from
// `<LeftRailCompactCalendar` to the matching `/>`. We use a simple
// non-greedy regex and accept a generous slice.
const m = /<LeftRailCompactCalendar[\s\S]*?\/>/.exec(src);
if (!m) {
  failures.push("Could not locate <LeftRailCompactCalendar ... /> usage in TeamPortalShell.tsx");
} else {
  const block = m[0];
  const forbidden = [
    "setSelectedDate(",
    "setFacility(",
    "setSelectedPatientId(",
    "setActiveWorkspaceMode(",
    "setViewAsTeamMemberId(",
  ];
  for (const f of forbidden) {
    if (block.includes(f)) {
      failures.push(
        `LeftRailCompactCalendar must not call ${f} — that would leak the global calendar date into the right-rail queue`,
      );
    }
  }
  // It MUST bind to globalCalendarDate.
  if (!block.includes("globalCalendarDate")) {
    failures.push("LeftRailCompactCalendar must bind to globalCalendarDate (the isolated state)");
  }
}

if (failures.length > 0) {
  console.error("Left calendar isolation (right-queue safety) QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Left calendar isolation (right-queue safety) QA passed.");
