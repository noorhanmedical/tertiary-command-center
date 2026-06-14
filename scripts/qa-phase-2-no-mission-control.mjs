// QA — Phase 2 must not introduce Mission Control.
//
// Mission Control is explicitly Phase 7. The Phase 2 surfaces must
// not contain a page, route, nav entry, or component named
// MissionControl / mission-control.
//
// Run: node scripts/qa-phase-2-no-mission-control.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

// Page file forbidden.
const pageMissionControl = path.join(root, "client/src/pages/mission-control.tsx");
if (fs.existsSync(pageMissionControl)) {
  failures.push("Phase 2 must NOT create client/src/pages/mission-control.tsx");
}
// Component dir forbidden.
const dirMissionControl = path.join(root, "client/src/components/mission-control");
if (fs.existsSync(dirMissionControl)) {
  failures.push("Phase 2 must NOT create client/src/components/mission-control/");
}

// Nav must not include the label.
const navPath = path.join(root, "client/src/components/GlobalNav.tsx");
if (fs.existsSync(navPath)) {
  const nav = fs.readFileSync(navPath, "utf8");
  if (/Mission Control/i.test(nav)) {
    failures.push("GlobalNav.tsx must not contain a 'Mission Control' label");
  }
}

// App.tsx route forbidden.
const appPath = path.join(root, "client/src/App.tsx");
if (fs.existsSync(appPath)) {
  const app = fs.readFileSync(appPath, "utf8");
  if (/mission-control/.test(app)) {
    failures.push("App.tsx must not register a /mission-control route");
  }
}

if (failures.length > 0) {
  console.error("Phase-2 no-Mission-Control QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 no-Mission-Control QA passed.");
