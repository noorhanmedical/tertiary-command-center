// QA — Tasks tool must remain task management, NOT a productivity
// dashboard.
//
// Forbid productivity-dashboard tokens (metric tiles, KPIs, revenue,
// SLAs, leaderboards) inside the PortalPlexusTasksTab and inside the
// shell's tasks render branch.
//
// Run: node scripts/qa-team-portal-tasks-not-productivity-dashboard.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

const tab = "client/src/components/portal/PortalPlexusTasksTab.tsx";

requireNotText(
  tab,
  [
    "ProductivityDashboard",
    "RevenueDashboard",
    "Leaderboard",
    "KPI",
    "SLA tracker",
    "Calls per hour",
    "Conversion rate",
    "MissionControl",
  ],
  "Tasks tool must remain task management, not a productivity dashboard",
);

if (failures.length > 0) {
  console.error("Tasks not-productivity-dashboard QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Tasks not-productivity-dashboard QA passed.");
