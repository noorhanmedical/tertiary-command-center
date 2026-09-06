// Phase 4B — access-management Settings entry + nav visibility regression.
//   npx tsx tests/unit/accessSettingsVisibility.test.ts
// Exit 0 = pass; 1 = fail.
//
// Locks the permission-aware behavior: who can ENTER the access console, which
// nav item appears, and the display-name/label helpers. Pure logic only — no
// React render — so it runs under tsx like the other unit tests.

import { canEnterAccessSettings, SETTINGS_ENTRY_PERMISSIONS } from "@/lib/access/accessContext";
import { getWorkspaceById, canRoleSeeInSidebar, canRoleSeeWorkspace } from "@/lib/navigation/workspaceRegistry";
import { resolveDisplayName, workspaceLabel, auditActionLabel, scopeTypeLabel } from "@/lib/access/labels";

const failures: string[] = [];
function ok(label: string, cond: boolean) {
  if (!cond) failures.push(label);
}
function eq(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── canEnterAccessSettings ──────────────────────────────────────────────────
ok("no permissions cannot enter", !canEnterAccessSettings([]));
ok("undefined cannot enter", !canEnterAccessSettings(undefined));
ok("null cannot enter", !canEnterAccessSettings(null));
ok("users.view can enter", canEnterAccessSettings(["users.view"]));
ok("users.manage can enter", canEnterAccessSettings(["users.manage"]));
ok("organization.view can enter", canEnterAccessSettings(["organization.view"]));
ok("clinic.manage can enter", canEnterAccessSettings(["clinic.manage"]));
ok("platform.audit.view can enter", canEnterAccessSettings(["platform.audit.view"]));
ok("audit.organization.view can enter", canEnterAccessSettings(["audit.organization.view"]));
// Finance-only must NOT enter (finance permissions do not imply user admin).
ok("finance.view alone CANNOT enter", !canEnterAccessSettings(["finance.view", "finance.manage"]));
ok("investor perms CANNOT enter", !canEnterAccessSettings(["investor.dashboard.view", "investor.documents.view"]));
ok("clinical perms CANNOT enter", !canEnterAccessSettings(["patient.read", "order.sign", "procedure.perform"]));
// Every declared entry permission grants entry.
for (const p of SETTINGS_ENTRY_PERMISSIONS) ok(`entry perm ${p} grants entry`, canEnterAccessSettings([p]));

// ── Access workspace nav visibility (permission-aware) ──────────────────────
const access = getWorkspaceById("access");
ok("access workspace exists", !!access);
if (access) {
  // Legacy admin always sees it.
  ok("admin sees Access in sidebar", canRoleSeeInSidebar(access, "admin"));
  // Scoped admin WITHOUT the legacy admin role but WITH a settings permission.
  ok("organization_admin + users.view sees Access", canRoleSeeInSidebar(access, "organization_admin", ["users.view"]));
  ok("clinic_admin + clinic.manage sees Access", canRoleSeeInSidebar(access, "clinic_admin", ["clinic.manage"]));
  // No permission → hidden from sidebar.
  ok("clinician w/o perms does NOT see Access", !canRoleSeeInSidebar(access, "clinician", ["patient.read"]));
  ok("finance_manager w/o users.view does NOT see Access", !canRoleSeeInSidebar(access, "finance_manager", ["finance.view", "finance.manage"]));
  ok("no-permission call does NOT see Access", !canRoleSeeInSidebar(access, "scheduler"));
  // Tab eligibility (navigation-state only) is permissive by design.
  ok("access tab visible as workspace (nav-state only)", canRoleSeeWorkspace(access, "organization_admin"));
}

// The legacy admin Settings workspace stays admin-only for nav visibility.
const admin = getWorkspaceById("admin");
if (admin) {
  ok("admin workspace admin-only in sidebar", canRoleSeeInSidebar(admin, "admin"));
  ok("organization_admin does NOT see legacy admin workspace", !canRoleSeeInSidebar(admin, "organization_admin", ["users.view"]));
}

// ── Display-name fallback chain ─────────────────────────────────────────────
eq("displayName wins", resolveDisplayName({ displayName: "Calista Smith", firstName: "C", lastName: "S", username: "csmith" }), "Calista Smith");
eq("first+last fallback", resolveDisplayName({ firstName: "Calista", lastName: "Smith", username: "csmith" }), "Calista Smith");
eq("username fallback", resolveDisplayName({ username: "csmith" }), "csmith");
eq("email last resort", resolveDisplayName({ email: "c@x.io" }), "c@x.io");
eq("empty → Unknown user", resolveDisplayName({}), "Unknown user");

// ── Labels ──────────────────────────────────────────────────────────────────
eq("workspace label pcs", workspaceLabel("pcs"), "PCS Portal");
eq("workspace label unknown passthrough", workspaceLabel("weird_id"), "weird_id");
eq("workspace label null", workspaceLabel(null), "—");
eq("audit role label", auditActionLabel("user.role.assigned"), "Role Changed");
eq("audit status label", auditActionLabel("user.status.changed"), "Account Status Changed");
eq("audit unknown humanized", auditActionLabel("user.something.weird"), "Something Weird");
eq("scope label organization", scopeTypeLabel("organization"), "Organization");

if (failures.length) {
  console.error("accessSettingsVisibility.test.ts: FAILURES");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("accessSettingsVisibility.test.ts: all tests passed");
