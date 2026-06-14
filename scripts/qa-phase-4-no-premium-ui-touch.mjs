// QA — Phase 4 must not touch premium UI work claimed by PR #278.
//
// Run: node scripts/qa-phase-4-no-premium-ui-touch.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const FORBIDDEN_MARKERS = [
  "PremiumDashboard",
  "PremiumNavigation",
  "isPremiumUiEnabled",
];

const SCAN_DIRS = [
  "client/src/components/billing",
  "client/src/pages",
  "server/services/billing",
];
function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const m of FORBIDDEN_MARKERS) {
        if (src.includes(m)) {
          failures.push(`${dir}/${entry.name} contains premium-UI marker "${m}"`);
        }
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

if (failures.length > 0) {
  console.error("Phase-4 no-premium-UI-touch QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 no-premium-UI-touch QA passed.");
