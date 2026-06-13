// QA — Outreach Center is a marketing / metrics surface, not an
// execution portal.
//
// Boundary check:
//   - The page surfaced at /scheduler-portal (legacy URL) is the
//     OutreachPage. It MUST display marketing / call-coverage metrics
//     and MUST NOT route users into execution work that belongs in
//     PCS / ACS Workspaces.
//   - The Team Member Portals landing page MUST NOT link to
//     /scheduler-portal as an execution portal.
//   - GlobalNav labels /scheduler-portal as "Outreach Center" (not
//     "Scheduler Portal").
//
// Run: node scripts/qa-outreach-is-marketing-not-execution.mjs

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

const outreachPage = "client/src/pages/outreach.tsx";
const nav = "client/src/components/GlobalNav.tsx";
const tile = "client/src/pages/team-member-portals.tsx";
const app = "client/src/App.tsx";

// 1) OutreachPage exists and shows marketing-style content (scheduler
//    coverage cards, conversion metrics). We require a couple of
//    marketing terms to anchor the contract.
requireText(outreachPage, [
  "OutreachDashboard",
  "conversionRate",
  "capacityPercent",
  "schedulerCards",
]);

// 2) Outreach Center must NOT route users to PCS/ACS execution pages
//    as primary actions. Inline links to the workspace are forbidden.
requireNotText(
  outreachPage,
  [
    'href="/patient-care-specialist-portal"',
    'href="/ancillary-care-specialist-portal"',
  ],
  "OutreachPage must not route directly into PCS/ACS execution workspaces",
);

// 3) Team Member Portals landing must not list Outreach Center as a tile.
requireNotText(
  tile,
  [
    '"/scheduler-portal"',
    '"/outreach"',
    '"/outreach-center"',
  ],
  "Team Member Portals landing must not list any outreach surface as an execution tile",
);

// 4) GlobalNav label is "Outreach Center".
requireText(nav, ['"Outreach Center"']);

// 5) /scheduler-portal still resolves (back-compat) but mounts the
//    OutreachPage, not a separate scheduler-portal component.
requireText(app, [
  '<Route path="/scheduler-portal" component={OutreachPage} />',
]);

if (failures.length > 0) {
  console.error("Outreach-is-marketing QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach-is-marketing QA passed.");
