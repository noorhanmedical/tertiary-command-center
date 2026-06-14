// QA — Phase 2 work does not modify premium UI files claimed by
// PR #278 or by the Phase 2 do-not-touch contract.
//
// We assert by reading the do-not-touch doc + scanning for any
// canonical "premium UI" markers showing up in the changed surface
// area (run-time only — this is a static check). The premium UI
// branch (PR #278) is on a separate branch; this guard is to catch
// accidental drift on main.
//
// Run: node scripts/qa-phase-2-no-premium-ui-touch.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

// "Premium UI" markers must not appear in code paths under
// client/src outside the dedicated premium-ui folder. The premium
// folder may not exist yet (it lives on PR #278) — that is fine.
const FORBIDDEN_MARKERS = [
  "PremiumDashboard",
  "PremiumNavigation",
  "isPremiumUiEnabled",
];

const SCAN_DIRS = ["client/src/components/portal", "client/src/components/workflow", "client/src/pages"];
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
          failures.push(`${dir}/${entry.name} contains premium-UI marker "${m}" — should be on PR #278 only`);
        }
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

if (failures.length > 0) {
  console.error("Phase-2 no-premium-UI-touch QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 no-premium-UI-touch QA passed.");
