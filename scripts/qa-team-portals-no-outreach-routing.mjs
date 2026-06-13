// QA — Team Portal landing tiles route ONLY to PCS + ACS.
//
// The Team Member Portals landing page must not present Outreach
// Center, Engagement Center, Scheduler Portal, or Mission Control as
// tiles. Outreach is a marketing surface; Engagement Center is a
// manager-level assignment surface; neither is an execution portal.
//
// The /scheduler-portal route survives for back-compat but the visible
// nav label must read "Outreach Center", NOT "Scheduler Portal" — the
// guardrails forbid the standalone Scheduler Portal product concept.
//
// Run: node scripts/qa-team-portals-no-outreach-routing.mjs

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

const tile = "client/src/pages/team-member-portals.tsx";
const nav = "client/src/components/GlobalNav.tsx";

// 1) Tiles include PCS + ACS.
requireText(tile, [
  "card-patient-care-specialist-workspace",
  "card-ancillary-care-specialist-workspace",
  '"/patient-care-specialist-portal"',
  '"/ancillary-care-specialist-portal"',
  // Source marker so future refactors don't accidentally re-introduce
  // the Engagement Center / Outreach Center tile.
  "PHASE-1 TEAM-PORTAL ROUTING",
]);

// 2) Tiles must NOT include Engagement / Outreach / Scheduler /
//    Mission Control entries.
requireNotText(
  tile,
  [
    "card-engagement-center",
    '"/engagement-center"',
    '"/scheduler-portal"',
    '"/outreach"',
    '"/outreach-center"',
    "Mission Control",
    "Scheduler Portal",
  ],
  "Team Member Portals landing must not list non-execution surfaces as tiles",
);

// 3) Nav label correction: "Scheduler Portal" → "Outreach Center".
requireText(nav, [
  '"Outreach Center"',
  '"/scheduler-portal"', // path stays for back-compat
]);
requireNotText(
  nav,
  ['"Scheduler Portal"'],
  "GlobalNav must not visibly label /scheduler-portal as 'Scheduler Portal'",
);

if (failures.length > 0) {
  console.error("Team Portal no-outreach-routing QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal no-outreach-routing QA passed.");
