// QA — Phase 4 must not introduce a standalone Scheduler Portal.
//
// Run: node scripts/qa-phase-4-no-scheduler-portal.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const FORBIDDEN_PAGES = [
  "client/src/pages/scheduler-portal-product.tsx",
  "client/src/pages/scheduler-product.tsx",
];
for (const f of FORBIDDEN_PAGES) {
  if (fs.existsSync(path.join(root, f))) failures.push(`forbidden file: ${f}`);
}

const nav = fs.existsSync(path.join(root, "client/src/components/GlobalNav.tsx"))
  ? fs.readFileSync(path.join(root, "client/src/components/GlobalNav.tsx"), "utf8") : "";
if (/Scheduler Portal/.test(nav)) {
  failures.push("GlobalNav must not contain 'Scheduler Portal' label");
}

if (failures.length > 0) {
  console.error("Phase-4 no-Scheduler-Portal QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 no-Scheduler-Portal QA passed.");
