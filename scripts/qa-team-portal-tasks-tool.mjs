// QA — Tasks left-rail tool opens active/user tasks in the center
// canvas via the existing tasks tab.
//
// Run: node scripts/qa-team-portal-tasks-tool.mjs

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

const tab = "client/src/components/portal/PortalPlexusTasksTab.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const portal = "server/routes/portal.ts";

// 1) Existing tasks tab component still present.
requireText(tab, [
  "PortalPlexusTasksTab",
]);

// 2) Shell exposes the Tasks left-rail tool and routes to the existing
//    plexusTasks center-canvas surface.
requireText(shell, [
  "left-rail-tool-tasks",
  '"plexusTasks"',
  "PortalPlexusTasksTab",
  "<PortalPlexusTasksTab",
  // Badge surfaces the live count from tasksData.
  "taskCount",
]);

// 3) Backend endpoint exists.
requireText(portal, [
  '"/api/portal/my-tasks"',
]);

if (failures.length > 0) {
  console.error("Team Portal tasks tool QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal tasks tool QA passed.");
