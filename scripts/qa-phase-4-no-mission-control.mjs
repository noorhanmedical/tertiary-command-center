// QA — Phase 4 must not introduce Mission Control.
//
// Run: node scripts/qa-phase-4-no-mission-control.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

if (fs.existsSync(path.join(root, "client/src/pages/mission-control.tsx"))) {
  failures.push("client/src/pages/mission-control.tsx must not be created in Phase 4");
}
if (fs.existsSync(path.join(root, "client/src/components/mission-control"))) {
  failures.push("client/src/components/mission-control/ must not be created in Phase 4");
}
const app = fs.existsSync(path.join(root, "client/src/App.tsx"))
  ? fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8") : "";
if (/mission-control/i.test(app)) {
  failures.push("App.tsx must not register a /mission-control route");
}
const nav = fs.existsSync(path.join(root, "client/src/components/GlobalNav.tsx"))
  ? fs.readFileSync(path.join(root, "client/src/components/GlobalNav.tsx"), "utf8") : "";
if (/Mission Control/i.test(nav)) {
  failures.push("GlobalNav must not contain a 'Mission Control' label");
}

if (failures.length > 0) {
  console.error("Phase-4 no-Mission-Control QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 no-Mission-Control QA passed.");
