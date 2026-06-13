// QA — No Mission Control surface anywhere.
//
// Mission Control is Phase 7. It must not exist as a page, component,
// route, or nav entry today.
//
// Run: node scripts/qa-no-mission-control-anywhere.mjs

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

// 1) No mission-control page file.
const PAGES = path.join(root, "client", "src", "pages");
if (fs.existsSync(PAGES)) {
  for (const f of fs.readdirSync(PAGES)) {
    if (/mission/i.test(f)) {
      failures.push(`Forbidden Mission Control page: client/src/pages/${f}`);
    }
  }
}

// 2) No mission-control component dir.
const COMPONENTS = path.join(root, "client", "src", "components");
if (fs.existsSync(COMPONENTS)) {
  for (const f of fs.readdirSync(COMPONENTS)) {
    if (/^mission/i.test(f)) {
      failures.push(`Forbidden Mission Control component dir: client/src/components/${f}`);
    }
  }
}

// 3) No nav entry mentioning Mission Control.
requireNotText(
  "client/src/components/GlobalNav.tsx",
  ["Mission Control"],
  "GlobalNav must not list a Mission Control entry",
);
requireNotText(
  "client/src/pages/team-member-portals.tsx",
  ["Mission Control"],
  "Team Member Portals landing must not list Mission Control",
);

// 4) No mission-control route in App.tsx.
requireNotText(
  "client/src/App.tsx",
  ['path="/mission-control"', "MissionControlPage", "MissionControl"],
  "App.tsx must not register any Mission Control route",
);

if (failures.length > 0) {
  console.error("No-Mission-Control QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("No-Mission-Control QA passed.");
