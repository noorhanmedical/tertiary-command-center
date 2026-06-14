// QA — Phase 2 must not introduce a standalone Scheduler Portal
// product surface. PCS and ACS share the call list — there is no
// separate Scheduler Portal product.
//
// We allow the existing /scheduler-portal route alias (it mounts the
// outreach page) but forbid any new SchedulerPortal* React component
// or "Scheduler Portal" navigation label.
//
// Run: node scripts/qa-phase-2-no-standalone-scheduler-portal.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

// New page files forbidden.
const FORBIDDEN_PAGES = [
  "client/src/pages/scheduler-portal-product.tsx",
  "client/src/pages/scheduler-product.tsx",
];
for (const f of FORBIDDEN_PAGES) {
  if (fs.existsSync(path.join(root, f))) {
    failures.push(`Phase 2 must NOT create ${f}`);
  }
}

// Forbidden component prefixes.
const FORBIDDEN_COMPONENT_PREFIXES = [
  "SchedulerPortalProduct",
  "SchedulerProduct",
  "StandaloneSchedulerPortal",
];
const SCAN_DIRS = ["client/src/components", "client/src/pages"];
function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const p of FORBIDDEN_COMPONENT_PREFIXES) {
        if (new RegExp(`(function|const|class)\\s+${p}`).test(src)) {
          failures.push(`${dir}/${entry.name} defines forbidden Scheduler Portal product component "${p}"`);
        }
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

// Nav label.
const navPath = path.join(root, "client/src/components/GlobalNav.tsx");
if (fs.existsSync(navPath)) {
  const nav = fs.readFileSync(navPath, "utf8");
  if (/Scheduler Portal/.test(nav)) {
    failures.push("GlobalNav.tsx must not contain a 'Scheduler Portal' label (PCS + ACS share the call list)");
  }
}

if (failures.length > 0) {
  console.error("Phase-2 no-standalone-Scheduler-Portal QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 no-standalone-Scheduler-Portal QA passed.");
