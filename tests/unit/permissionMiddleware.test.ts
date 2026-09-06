// Permission decision — pure logic regression (Phase 3).
//   npx tsx tests/unit/permissionMiddleware.test.ts
// Exit 0 = pass; 1 = fail. No DB required.

import { decideAccess } from "../../server/middleware/accessDecision";
import type { AccessContext } from "../../server/services/access/accessContextService";

const failures: string[] = [];
function ok(label: string, cond: boolean) {
  if (!cond) failures.push(label);
}

function mkCtx(opts: {
  permissions?: string[];
  platform?: boolean;
  clinicIds?: number[];
  organizationIds?: number[];
  isActive?: boolean;
}): AccessContext {
  return {
    id: "u",
    username: "u",
    email: null,
    displayName: null,
    jobTitle: null,
    accountStatus: opts.isActive === false ? "inactive" : "active",
    isActive: opts.isActive !== false,
    roles: [],
    permissions: opts.permissions ?? [],
    scope: {
      platform: !!opts.platform,
      organizationIds: opts.organizationIds ?? [],
      clinicIds: opts.clinicIds ?? [],
    },
    serviceAccess: [],
    defaultWorkspace: "plexus_home",
    lastLoginAt: null,
    legacyRole: null,
    legacyClinicId: null,
  };
}

// #1 authenticated user lacking permission → 403
{
  const d = decideAccess(mkCtx({ permissions: ["patient.read"] }), { permissions: ["users.manage"], mode: "all" });
  ok("#1 lacking permission → 403", !d.ok && d.status === 403 && d.reason === "missing_permission");
}
// #2 user with permission → allow
{
  const d = decideAccess(mkCtx({ permissions: ["users.manage"] }), { permissions: ["users.manage"], mode: "all" });
  ok("#2 has permission → ok", d.ok === true);
}
// #3 DENY override defeats role grant (resolver removed the key) → 403
{
  const d = decideAccess(mkCtx({ permissions: ["patient.read" /* order.sign denied → absent */] }), { permissions: ["order.sign"], mode: "all" });
  ok("#3 denied (absent) permission → 403", !d.ok && d.status === 403);
}
// #4 GRANT works (key present)
{
  const d = decideAccess(mkCtx({ permissions: ["reporting.view"] }), { permissions: ["reporting.view"], mode: "all" });
  ok("#4 granted permission → ok", d.ok === true);
}
// #5 inactive user → 401
{
  const d = decideAccess(mkCtx({ permissions: ["users.manage"], isActive: false }), { permissions: ["users.manage"], mode: "all" });
  ok("#5 inactive → 401", !d.ok && d.status === 401);
}
// null context → 401
{
  const d = decideAccess(null, { permissions: ["users.manage"], mode: "all" });
  ok("null ctx → 401", !d.ok && d.status === 401);
}
// #6 decision uses ONLY resolved permissions (never a role string). Empty perms → deny.
{
  const d = decideAccess(mkCtx({ permissions: [] }), { permissions: ["users.manage"], mode: "all" });
  ok("#6 no permissions → 403 (role string irrelevant)", !d.ok && d.status === 403);
}
// #7 platform scope required
{
  const noPlat = decideAccess(mkCtx({ permissions: ["users.manage"], platform: false }), { permissions: ["users.manage"], mode: "all", platform: true });
  ok("#7 has permission but no platform scope → 403 requires_platform_scope", !noPlat.ok && noPlat.reason === "requires_platform_scope");
  const plat = decideAccess(mkCtx({ permissions: ["users.manage"], platform: true }), { permissions: ["users.manage"], mode: "all", platform: true });
  ok("#7 permission + platform scope → ok", plat.ok === true);
}
// mode any / all
{
  const anyOk = decideAccess(mkCtx({ permissions: ["billing.view"] }), { permissions: ["billing.view", "finance.view"], mode: "any" });
  ok("mode any: one of → ok", anyOk.ok === true);
  const allFail = decideAccess(mkCtx({ permissions: ["billing.view"] }), { permissions: ["billing.view", "finance.view"], mode: "all" });
  ok("mode all: missing one → 403", !allFail.ok);
}
// #28 clinic scope: cannot bypass by targeting an out-of-scope clinic
{
  const inScope = decideAccess(mkCtx({ permissions: ["clinic.manage"], clinicIds: [1] }), { permissions: ["clinic.manage"], mode: "all", clinicId: 1 });
  ok("#28 clinic in scope → ok", inScope.ok === true);
  const outScope = decideAccess(mkCtx({ permissions: ["clinic.manage"], clinicIds: [1] }), { permissions: ["clinic.manage"], mode: "all", clinicId: 2 });
  ok("#28 clinic out of scope → 403 clinic_out_of_scope", !outScope.ok && outScope.reason === "clinic_out_of_scope");
  const platAny = decideAccess(mkCtx({ permissions: ["clinic.manage"], platform: true }), { permissions: ["clinic.manage"], mode: "all", clinicId: 999 });
  ok("#28 platform scope → any clinic ok", platAny.ok === true);
  const nullClinic = decideAccess(mkCtx({ permissions: ["clinic.manage"], clinicIds: [1] }), { permissions: ["clinic.manage"], mode: "all", clinicId: null });
  ok("#28 null target clinic (non-platform) → 403", !nullClinic.ok);
}
// organization scope
{
  const inOrg = decideAccess(mkCtx({ permissions: ["organization.manage"], organizationIds: [5] }), { permissions: ["organization.manage"], mode: "all", organizationId: 5 });
  ok("org in scope → ok", inOrg.ok === true);
  const outOrg = decideAccess(mkCtx({ permissions: ["organization.manage"], organizationIds: [5] }), { permissions: ["organization.manage"], mode: "all", organizationId: 6 });
  ok("org out of scope → 403 organization_out_of_scope", !outOrg.ok && outOrg.reason === "organization_out_of_scope");
}
// #24 platform scope ≠ capability: technical/platform user without PHI perm is denied patient access
{
  const swe = mkCtx({ permissions: ["technical.view"], platform: true });
  ok("#24 software-engineer-like (platform, technical.view only) cannot read patients", !decideAccess(swe, { permissions: ["patient.read"], mode: "all" }).ok);
  ok("#24 same user CAN use technical.view", decideAccess(swe, { permissions: ["technical.view"], mode: "all" }).ok === true);
}
// #25 investor-like (aggregate only) cannot touch billing/admin/clinical
{
  const investor = mkCtx({ permissions: ["investor.dashboard.view", "investor.documents.view"], organizationIds: [1] });
  ok("#25 investor cannot billing.view", !decideAccess(investor, { permissions: ["billing.view"], mode: "all" }).ok);
  ok("#25 investor cannot users.manage", !decideAccess(investor, { permissions: ["users.manage"], mode: "all" }).ok);
  ok("#25 investor cannot patient.read", !decideAccess(investor, { permissions: ["patient.read"], mode: "all" }).ok);
  ok("#25 investor is not platform-scoped in this fixture", investor.scope.platform === false);
}

if (failures.length) {
  console.error("permissionMiddleware.test.ts: FAILURES");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("permissionMiddleware.test.ts: all tests passed");
