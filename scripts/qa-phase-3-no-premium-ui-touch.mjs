// QA — Phase 3 must not touch premium UI work.
// Run: node scripts/qa-phase-3-no-premium-ui-touch.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const FORBIDDEN = ["PremiumDashboard", "PremiumNavigation", "isPremiumUiEnabled"];
const SCAN_DIRS = [
  "server/services/exceptionIntelligence",
  "server/services/ai",
  "client/src/pages",
  "client/src/components/exceptions",
];
function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name));
    else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const m of FORBIDDEN) {
        if (src.includes(m)) failures.push(`${dir}/${entry.name} contains premium-UI marker "${m}"`);
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

if (failures.length > 0) {
  console.error("Phase-3 no-premium-UI-touch QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 no-premium-UI-touch QA passed.");
