// QA — No standalone Scheduler Portal product.
//
// `/scheduler-portal` is the LEGACY URL path that mounts OutreachPage
// (marketing / scheduler-coverage metrics). Its nav label was
// corrected to "Outreach Center" in PR #280. The product concept of a
// standalone Scheduler Portal is forbidden.
//
// This QA asserts:
//   1. No SchedulerPortalPage / SchedulerPortalShell file exists.
//   2. No nav entry / tile labels its target "Scheduler Portal".
//   3. /scheduler-portal still resolves (back-compat) but mounts the
//      OutreachPage component, NOT a SchedulerPortal* file.
//
// Run: node scripts/qa-no-scheduler-portal-product.mjs

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

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

// 1) No SchedulerPortal* page/shell files.
const PAGES = path.join(root, "client", "src", "pages");
if (fs.existsSync(PAGES)) {
  for (const f of fs.readdirSync(PAGES)) {
    if (/^scheduler-portal\.tsx$/i.test(f) || /^SchedulerPortal.*\.tsx$/.test(f)) {
      failures.push(`Forbidden Scheduler Portal product file: client/src/pages/${f}`);
    }
  }
}
const PORTAL_COMPONENTS = path.join(root, "client", "src", "components", "portal");
if (fs.existsSync(PORTAL_COMPONENTS)) {
  for (const f of fs.readdirSync(PORTAL_COMPONENTS)) {
    if (/^SchedulerPortal.*\.tsx$/.test(f)) {
      failures.push(`Forbidden Scheduler Portal shell: client/src/components/portal/${f}`);
    }
  }
}

// 2) Nav must NOT label any entry "Scheduler Portal".
requireNotText(
  "client/src/components/GlobalNav.tsx",
  ['"Scheduler Portal"'],
  "GlobalNav must not visibly label /scheduler-portal as Scheduler Portal",
);
requireNotText(
  "client/src/pages/team-member-portals.tsx",
  ['"Scheduler Portal"', "card-scheduler-portal"],
  "Team Member Portals landing must not list a Scheduler Portal tile",
);

// 3) /scheduler-portal still resolves to the OutreachPage (back-compat).
requireText(
  "client/src/App.tsx",
  ['<Route path="/scheduler-portal" component={OutreachPage} />'],
);

if (failures.length > 0) {
  console.error("No-Scheduler-Portal-product QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("No-Scheduler-Portal-product QA passed.");
