// QA — Server-side facility scoping for Phase 1 team-portal feeds.
//
// Phase 1 portal feeds must enforce server-side facility scope so an
// authenticated user cannot pull data for a facility they are not
// assigned to by passing `?facilityId=...` in the query string.
//
// Scoped endpoints (Phase 1):
//   /api/technician-liaison/clinic-visits
//   /api/technician-liaison/ancillary-schedule
//   /api/scheduler-portal/cases
//
// Source-level enforcement: each handler must apply requirePortalRole
// middleware AND check the requested facilityId against the result of
// allowedFacilities(req).
//
// Run: node scripts/qa-phase-1-facility-scoping.mjs

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
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

const portal = "server/routes/portal.ts";
const gs = "server/routes/globalSchedule.ts";
const ec = "server/routes/executionCases.ts";

// 1) The portal route file must export the shared role guard + facility
//    resolver so other route files can share enforcement.
requireText(portal, [
  "export const requirePortalRole",
  "export async function allowedFacilities",
]);

// 2) Each Phase 1 team-portal feed endpoint must apply requirePortalRole
//    AND check facility scope using allowedFacilities. The fix block
//    uses a comment marker so the scoping assertion is easy to grep.
requireText(gs, [
  "requirePortalRole",
  "allowedFacilities",
  // explicit Phase 1 marker so future refactors don't accidentally
  // strip the scoping block:
  "PHASE-1 FACILITY SCOPE",
]);
requireText(ec, [
  "requirePortalRole",
  "allowedFacilities",
  "PHASE-1 FACILITY SCOPE",
]);

if (failures.length > 0) {
  console.error("Phase 1 facility-scoping QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 facility-scoping QA passed.");
