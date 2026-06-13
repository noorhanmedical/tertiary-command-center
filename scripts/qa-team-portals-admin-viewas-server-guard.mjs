// QA — Server-side admin guard for the view-as endpoint + resolver.
//
// Asserts:
//   1. /api/portal/team-members is admin-only at the route level.
//   2. resolveAdminViewAsUserId returns null for non-admin callers
//      (defense-in-depth even if the resolver is invoked elsewhere).
//   3. allowedFacilities respects the viewAsUserId override only when
//      the caller is admin.
//   4. The role-mapping (PCS↔liaison, ACS↔technician) is enforced.
//
// Run: node scripts/qa-team-portals-admin-viewas-server-guard.mjs

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

// 1) Endpoint exists + admin-gated.
requireText(portal, [
  '"/api/portal/team-members"',
  "requirePortalRole",
  "Forbidden — admin role required",
  // workspace param must be one of pcs/acs.
  'workspace must be \'pcs\' or \'acs\'',
]);

// 2) Resolver returns null for non-admin and enforces role match.
requireText(portal, [
  "resolveAdminViewAsUserId",
  '(req.session.role ?? "") !== "admin"',
  "VIEWAS_WORKSPACE_TO_ROLE",
  '"liaison"',
  '"technician"',
]);

// 3) allowedFacilities honors viewAsUserId from admin only.
requireText(portal, [
  "allowedFacilities(",
  "viewAsUserId",
  // The admin-check before applying the override:
  "isAdmin ? (opts.viewAsUserId ?? null) : null",
]);

if (failures.length > 0) {
  console.error("Admin view-as server-guard QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Admin view-as server-guard QA passed.");
