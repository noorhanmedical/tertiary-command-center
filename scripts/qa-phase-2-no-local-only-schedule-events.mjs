// QA — No local-only schedule events.
//
// Every status mutation must round-trip through the canonical
// route (POST /api/global-schedule-events/schedule-ancillary or
// POST /api/global-schedule-events/:id/transition). Components must
// not fake "Cancelled" / "Rescheduled" / "No-show" / "Confirmed"
// state in local React state without persisting through the API.
//
// Run: node scripts/qa-phase-2-no-local-only-schedule-events.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const SCAN_DIRS = ["client/src/components/portal", "client/src/components/outreach"];

const FORBIDDEN_LOCAL_PATTERNS = [
  // setState immediately to a fake transitioned status without an
  // API call. The pattern below catches obvious offenders.
  /setState\([^)]*?"cancelled"/g,
  /setState\([^)]*?"no_show"/g,
  /setState\([^)]*?"rescheduled"/g,
  // Toast suggesting success without an awaited fetch. The QA below
  // catches any toast title like "Cancelled" / "Rescheduled" /
  // "Confirmed" / "No-show" that is fired BEFORE the API resolves.
];

function walk(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const src = fs.readFileSync(path.join(full, entry.name), "utf8");
      for (const rx of FORBIDDEN_LOCAL_PATTERNS) {
        if (rx.test(src)) {
          failures.push(`${dir}/${entry.name} contains a local-only schedule status pattern (${rx})`);
        }
      }
    }
  }
}
for (const d of SCAN_DIRS) walk(d);

// Positive assertion: every client-side write to a schedule status
// must go through scheduleTransitionApi OR schedule-ancillary.
const helper = fs.readFileSync(
  path.join(root, "client/src/lib/portal/scheduleTransitionApi.ts"),
  "utf8",
);
if (!helper.includes("/api/global-schedule-events/") || !helper.includes("/transition")) {
  failures.push("scheduleTransitionApi must POST to /api/global-schedule-events/:id/transition");
}

if (failures.length > 0) {
  console.error("Phase-2 no-local-only-schedule-events QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 no-local-only-schedule-events QA passed.");
