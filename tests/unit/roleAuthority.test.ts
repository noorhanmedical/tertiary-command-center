// Access-management AUTHORITY / privilege-escalation rules — pure unit test.
//   npx tsx tests/unit/roleAuthority.test.ts

import {
  canGrantPermission, canAssignRole, canAssignOrganization, canAssignClinic,
  canAssignService, canAdministerTarget, isValidRoleKey, isValidPermissionKey,
  isValidWorkspaceId,
} from "../../server/services/access/roleAuthority";
import type { AccessContext } from "../../server/services/access/accessContextService";

const failures: string[] = [];
const ok = (label: string, cond: boolean) => { if (!cond) failures.push(label); };

function ctx(o: { permissions?: string[]; platform?: boolean; orgs?: number[]; clinics?: number[]; services?: string[] }): AccessContext {
  return {
    id: "u", username: "u", email: null, displayName: null, jobTitle: null,
    accountStatus: "active", isActive: true, roles: [],
    permissions: o.permissions ?? [], serviceAccess: o.services ?? [],
    scope: { platform: !!o.platform, organizationIds: o.orgs ?? [], clinicIds: o.clinics ?? [] },
    defaultWorkspace: "plexus_home", lastLoginAt: null, legacyRole: null, legacyClinicId: null,
  };
}

// A platform admin with the full platform_admin bundle (subset used here).
const platformAdmin = ctx({
  platform: true,
  permissions: [
    "users.view", "users.manage", "organization.view", "organization.manage",
    "clinic.view", "clinic.manage", "platform.settings.view", "platform.settings.manage",
    "platform.audit.view", "billing.view", "billing.manage", "finance.view", "finance.manage",
    "patient.read", "reporting.view", "staff.view", "staff.manage", "technical.view",
    "reporting.executive.view", "reporting.financial.view", "reporting.clinical.view",
    "audit.organization.view",
  ],
});
// Org admin: users.manage etc, org scope, NO platform scope, no clinical/platform-settings perms.
const orgAdmin = ctx({
  orgs: [1], clinics: [1],
  permissions: ["organization.view", "organization.manage", "clinic.view", "clinic.manage", "users.view", "users.manage", "staff.view", "staff.manage", "reporting.view", "patient.read", "audit.organization.view"],
});
const clinicAdmin = ctx({ clinics: [1], permissions: ["clinic.view", "clinic.manage", "users.view", "users.manage", "staff.view", "staff.manage", "schedule.view", "schedule.manage", "reporting.view", "patient.read"] });

// ── #20/#24 grant only permissions you hold ──
ok("#20 actor cannot grant a permission it lacks", !canGrantPermission(orgAdmin, "platform.settings.manage").ok);
ok("platform admin CAN grant a permission it holds", canGrantPermission(platformAdmin, "billing.manage").ok);
ok("#24 arbitrary permission key rejected", !canGrantPermission(platformAdmin, "totally.madeup").ok && !isValidPermissionKey("totally.madeup"));

// ── #14/#19/#22 role assignment / higher-scope role ──
ok("platform admin can assign platform_admin", canAssignRole(platformAdmin, "platform_admin").ok);
ok("platform authority can assign a clinical role despite lacking PHI perms", canAssignRole(platformAdmin, "clinician").ok);
ok("platform authority can grant a permission it does not personally hold (PHI)", canGrantPermission(platformAdmin, "patient.clinical_data.view").ok);
ok("#14 org admin cannot assign platform role (no platform scope)", !canAssignRole(orgAdmin, "platform_admin").ok);
ok("#14 org admin cannot assign technical_admin (platform)", !canAssignRole(orgAdmin, "technical_admin").ok);
ok("#19 clinic admin cannot assign platform_admin", !canAssignRole(clinicAdmin, "platform_admin").ok);
ok("#22 org admin cannot assign clinician (lacks order.sign etc.)", !canAssignRole(orgAdmin, "clinician").ok);
ok("#23 arbitrary role key rejected", !canAssignRole(platformAdmin, "wat_role").ok && !isValidRoleKey("wat_role"));

// ── #21 scope assignment ──
ok("org admin can assign own org", canAssignOrganization(orgAdmin, 1).ok);
ok("#21 org admin cannot assign another org", !canAssignOrganization(orgAdmin, 2).ok);
ok("platform admin can assign any org", canAssignOrganization(platformAdmin, 999).ok);
ok("clinic admin can assign own clinic", canAssignClinic(clinicAdmin, 1).ok);
ok("#21 clinic admin cannot assign another clinic", !canAssignClinic(clinicAdmin, 2).ok);
ok("#18 clinic admin cannot assign an organization it lacks", !canAssignOrganization(clinicAdmin, 1).ok);

// ── services (separate from capability) ──
ok("platform admin can assign any service", canAssignService(platformAdmin, "ultrasound").ok);
ok("#29-ish actor without service cannot assign it", !canAssignService(orgAdmin, "ultrasound").ok);
ok("actor holding a service can assign it", canAssignService(ctx({ services: ["ultrasound"] }), "ultrasound").ok);

// ── target administration scope overlap ──
const targetOrg1 = ctx({ orgs: [1], clinics: [1] });
const targetOrg2 = ctx({ orgs: [2], clinics: [2] });
ok("platform admin may administer any target", canAdministerTarget(platformAdmin, targetOrg2).ok);
ok("org admin may administer target in own org", canAdministerTarget(orgAdmin, targetOrg1).ok);
ok("#12/#17 admin cannot administer target outside scope", !canAdministerTarget(orgAdmin, targetOrg2).ok);
ok("#17 clinic admin cannot administer another clinic's user", !canAdministerTarget(clinicAdmin, targetOrg2).ok);

// ── #25 workspace validity ──
ok("#25 valid workspace accepted", isValidWorkspaceId("clinical"));
ok("#25 arbitrary workspace URL rejected", !isValidWorkspaceId("https://evil/x") && !isValidWorkspaceId("/admin/settings"));

if (failures.length) {
  console.error("roleAuthority.test.ts: FAILURES");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("roleAuthority.test.ts: all tests passed");
