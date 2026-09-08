// Default-workspace → route translation regression (Reconciliation 2.5).
//   npx tsx tests/unit/defaultWorkspaceRouteMap.test.ts
// Exit 0 = pass; 1 = fail.

import {
  resolveDefaultWorkspaceRoute,
  WORKSPACE_IDENTIFIER_ROUTES,
  ACCESS_PENDING_ROUTE,
  DEFAULT_FALLBACK_ROUTE,
} from "@/lib/navigation/defaultWorkspaceRoutes";
import { isTeamPortalRoute, isAdminWorkspaceRoute } from "@/lib/navigation/workspaceRegistry";

const failures: string[] = [];
function eq(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(label: string, cond: boolean) {
  if (!cond) failures.push(label);
}

// The controlled identifier set (locked here as a regression guard; mirrors
// WORKSPACE_IDENTIFIERS in shared/schema/access.ts).
const IDENTIFIERS = [
  "plexus_home", "platform_admin", "organization_admin", "clinic_admin", "clinical",
  "acs", "pcs", "technician", "operations", "finance", "billing", "executive",
  "investor", "technical", "compliance", "patient_support", "implementation",
];

// Every identifier must have an EXPLICIT mapping (never silently fall back).
for (const id of IDENTIFIERS) {
  ok(`identifier "${id}" has explicit route mapping`, id in WORKSPACE_IDENTIFIER_ROUTES);
}

// #1–#11 canonical mappings
eq("#1 plexus_home", resolveDefaultWorkspaceRoute("plexus_home"), "/home");
eq("#2 platform_admin", resolveDefaultWorkspaceRoute("platform_admin"), "/home");
eq("#3 clinical", resolveDefaultWorkspaceRoute("clinical"), "/clinician-portal");
eq("#4 pcs", resolveDefaultWorkspaceRoute("pcs"), "/patient-care-specialist-portal");
eq("#5 acs", resolveDefaultWorkspaceRoute("acs"), "/ancillary-care-specialist-portal");
eq("#6 technician (temporary → ACS/ancillary portal)", resolveDefaultWorkspaceRoute("technician"), "/ancillary-care-specialist-portal");
eq("#7 billing", resolveDefaultWorkspaceRoute("billing"), "/billing");
eq("#8 operations", resolveDefaultWorkspaceRoute("operations"), "/mission-control");
eq("#9 finance", resolveDefaultWorkspaceRoute("finance"), "/plexus-bank");
eq("#10 implementation", resolveDefaultWorkspaceRoute("implementation"), "/clinic-onboarding");
eq("#11 compliance", resolveDefaultWorkspaceRoute("compliance"), "/admin/settings?tab=logs");
eq("organization_admin → settings", resolveDefaultWorkspaceRoute("organization_admin"), "/admin/settings");
eq("clinic_admin → settings", resolveDefaultWorkspaceRoute("clinic_admin"), "/admin/settings");

// Investor special case — neutral surface, never /home.
eq("investor → access-pending", resolveDefaultWorkspaceRoute("investor"), ACCESS_PENDING_ROUTE);
ok("investor NOT routed to /home", resolveDefaultWorkspaceRoute("investor") !== "/home");
eq("access-pending route value", ACCESS_PENDING_ROUTE, "/access-pending");

// #12 unknown identifier → safe fallback
eq("#12 unknown → fallback", resolveDefaultWorkspaceRoute("does_not_exist"), DEFAULT_FALLBACK_ROUTE);
eq("null → fallback", resolveDefaultWorkspaceRoute(null), "/home");
eq("undefined → fallback", resolveDefaultWorkspaceRoute(undefined), "/home");

// #13 arbitrary DB value cannot become an arbitrary URL
const evil = "https://evil.example/steal";
eq("#13 arbitrary string → fallback (not echoed)", resolveDefaultWorkspaceRoute(evil), "/home");
ok("#13 arbitrary string never returned verbatim", resolveDefaultWorkspaceRoute(evil) !== evil);
eq("path-y injection → fallback", resolveDefaultWorkspaceRoute("/admin/settings?tab=logs"), "/home");

// #15/#16 PCS/ACS resolve to full-screen Team Portals that leave the Admin shell
for (const [id, route] of [["pcs", "/patient-care-specialist-portal"], ["acs", "/ancillary-care-specialist-portal"]] as const) {
  eq(`${id} → ${route}`, resolveDefaultWorkspaceRoute(id), route);
  ok(`${route} is a Team Portal route`, isTeamPortalRoute(route));
  ok(`${route} is NOT an Admin-shell route`, !isAdminWorkspaceRoute(route));
}

// #17/#18 Admin-shell landings
for (const route of ["/home", "/clinician-portal", "/billing", "/mission-control", "/plexus-bank", "/clinic-onboarding"]) {
  ok(`${route} stays inside the Admin shell`, isAdminWorkspaceRoute(route) && !isTeamPortalRoute(route));
}

if (failures.length) {
  console.error("defaultWorkspaceRouteMap.test.ts: FAILURES");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("defaultWorkspaceRouteMap.test.ts: all tests passed");
