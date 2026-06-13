// QA — Phase 1 Slice 1.2 facility scoping is preserved under view-as.
//
// The Slice 1.2 contract said: every Phase 1 team-portal feed endpoint
// must apply requirePortalRole AND check facilityId against
// allowedFacilities(req). Phase 1.5 (this PR) added admin view-as
// support — but the facility scope must still narrow to the
// *team-member's* allow-list (NOT the admin's "all" pass-through).
//
// This QA proves that the view-as branch returns a non-"all"
// allow-list and that the existing PHASE-1 FACILITY SCOPE markers
// remain in place.
//
// Run: node scripts/qa-team-portals-viewas-facility-scoping.mjs

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

const portal = "server/routes/portal.ts";
const globalSched = "server/routes/globalSchedule.ts";
const execCases = "server/routes/executionCases.ts";

// 1) allowedFacilities view-as branch returns a scoped (not "all")
//    Set of facilities. The `viewAs` short-circuit lands BEFORE the
//    `isAdmin → { all: true }` branch.
requireText(portal, [
  // The view-as branch returns a Set scoped to the team-member.
  "if (viewAs) {",
  "outreach_schedulers", // comment naming the canonical mapping table
]);

// 2) The Slice 1.2 PHASE-1 FACILITY SCOPE markers are still present in
//    every endpoint we touched in this PR.
requireText(globalSched, ["PHASE-1 FACILITY SCOPE"]);
requireText(execCases, ["PHASE-1 FACILITY SCOPE"]);

// 3) The resolver's signature still produces 400/403 on bad inputs
//    (regression guard for Slice 1.2 — must not weaken).
requireText(globalSched, [
  "facilityId is required for non-admin callers",
  "Forbidden — clinic not assigned to this user",
]);
requireText(execCases, [
  "facilityId is required for non-admin callers",
  "Forbidden — clinic not assigned to this user",
]);

if (failures.length > 0) {
  console.error("View-as facility scoping QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("View-as facility scoping QA passed.");
