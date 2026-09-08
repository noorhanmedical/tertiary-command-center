// Phase 3 access-control RUNTIME test — exercises the REAL resolveAccessContext
// against a DISPOSABLE database and asserts the permission-enforcement decision
// (decideAccess) for the migrated high-risk authority matrix.
//
//   DATABASE_URL=postgres://localhost:5432/plexus_access_phase3_test \
//     npx tsx script/testAccessControlPhase3.ts
//
// HARD SAFETY: refuses to run unless DATABASE_URL names a *phase3* database, so
// it can never touch plexus / plexus_secondary_command_center / prod / staging.

import { eq, and } from "drizzle-orm";

const URL = process.env.DATABASE_URL ?? "";
if (!/phase3/i.test(URL) || /secondary|prod|staging/i.test(URL)) {
  console.error(
    `[phase3] REFUSING to run: DATABASE_URL must name a disposable *phase3* DB. Got: ${URL.replace(/:[^:@/]*@/, ":****@")}`,
  );
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const { db, pool } = await import("../server/db");
  const { resolveAccessContext } = await import("../server/services/access/accessContextService");
  const { decideAccess } = await import("../server/middleware/accessDecision");
  const { users } = await import("@shared/schema/users");
  const { organizations, roles, userRoles, userOrganizations, userClinics } =
    await import("@shared/schema/access");

  try {
    // ── Organizations (1,2) ────────────────────────────────────────────────
    for (const id of [1, 2]) {
      const [o] = await db.select().from(organizations).where(eq(organizations.id, id));
      if (!o) await db.insert(organizations).values({ id, name: `Org ${id}`, slug: `org-${id}`, orgType: "group", status: "active" } as never);
    }

    const roleIdByKey = new Map((await db.select().from(roles)).map((r) => [r.key, r.id]));
    const rid = (key: string) => {
      const id = roleIdByKey.get(key);
      if (id == null) throw new Error(`seed missing role "${key}" — run seed:access-control first`);
      return id;
    };

    // ── Fixture users ───────────────────────────────────────────────────────
    // (id, legacyRole, roleKey, active, status, clinicId, orgId)
    const FIX: Array<{ id: string; role: string; roleKey: string; active?: boolean; status?: string; clinicId?: number | null; orgId?: number | null }> = [
      { id: "p3_pa",        role: "admin",     roleKey: "platform_admin" },
      { id: "p3_org",       role: "admin",     roleKey: "organization_admin", orgId: 1 },
      { id: "p3_clinic",    role: "admin",     roleKey: "clinic_admin", clinicId: 1 },
      { id: "p3_pcs",       role: "liaison",   roleKey: "pcs", clinicId: 1 },
      { id: "p3_acs",       role: "technician",roleKey: "acs", clinicId: 1 },
      { id: "p3_biller",    role: "biller",    roleKey: "billing_revenue_cycle" },
      { id: "p3_fin",       role: "admin",     roleKey: "finance_manager", orgId: 1 },
      { id: "p3_inv",       role: "clinician", roleKey: "investor", orgId: 1 },
      { id: "p3_swe",       role: "admin",     roleKey: "software_engineer" },
      { id: "p3_inactive",  role: "admin",     roleKey: "platform_admin", active: false, status: "inactive" },
      // Legacy role says "admin" but the ASSIGNED access role is only pcs →
      // proves a stale/legacy session.role can never grant a migrated permission.
      { id: "p3_fakeadmin", role: "admin",     roleKey: "pcs", clinicId: 1 },
    ];

    for (const f of FIX) {
      const [existing] = await db.select().from(users).where(eq(users.id, f.id));
      if (!existing) {
        await db.insert(users).values({
          id: f.id, username: f.id, password: "x", role: f.role,
          active: f.active ?? true, status: f.status ?? "active",
          clinicId: f.clinicId ?? null,
        } as never);
      }
      const [hasRole] = await db.select().from(userRoles)
        .where(and(eq(userRoles.userId, f.id), eq(userRoles.active, true))).limit(1);
      if (!hasRole) {
        await db.insert(userRoles).values({ userId: f.id, roleId: rid(f.roleKey), isPrimary: true, active: true } as never);
      }
      if (f.orgId != null) {
        const [ho] = await db.select().from(userOrganizations)
          .where(and(eq(userOrganizations.userId, f.id), eq(userOrganizations.organizationId, f.orgId), eq(userOrganizations.active, true))).limit(1);
        if (!ho) await db.insert(userOrganizations).values({ userId: f.id, organizationId: f.orgId, isPrimary: true, active: true } as never);
      }
      if (f.clinicId != null) {
        const [hc] = await db.select().from(userClinics)
          .where(and(eq(userClinics.userId, f.id), eq(userClinics.clinicId, f.clinicId), eq(userClinics.active, true))).limit(1);
        if (!hc) await db.insert(userClinics).values({ userId: f.id, clinicId: f.clinicId, isPrimary: true, active: true } as never);
      }
    }

    // Resolve every fixture's authoritative context up front.
    const ctx: Record<string, Awaited<ReturnType<typeof resolveAccessContext>>> = {};
    for (const f of FIX) ctx[f.id] = await resolveAccessContext(f.id);

    const allow = (id: string, spec: Parameters<typeof decideAccess>[1]) => decideAccess(ctx[id], spec).ok === true;
    const deny = (id: string, spec: Parameters<typeof decideAccess>[1]) => decideAccess(ctx[id], spec).ok === false;

    // Canonical specs used by the migrated routes.
    const USERS_MANAGE_PLATFORM = { permissions: ["users.manage"], mode: "all" as const, platform: true };
    const AUDIT_VIEW = { permissions: ["platform.audit.view"], mode: "all" as const };
    const SETTINGS_MANAGE = { permissions: ["platform.settings.manage"], mode: "all" as const };
    const CLINIC_MANAGE_PLATFORM = { permissions: ["clinic.manage"], mode: "all" as const, platform: true };

    console.log("\n[Authority — resolveAccessContext + decideAccess]");
    // #7/#8 Platform Admin: permission + platform scope for every migrated spec.
    check("#8 Platform Admin can manage users (users.manage + platform)", allow("p3_pa", USERS_MANAGE_PLATFORM));
    check("#7 Platform Admin has platform scope + audit + settings", allow("p3_pa", AUDIT_VIEW) && allow("p3_pa", SETTINGS_MANAGE) && allow("p3_pa", CLINIC_MANAGE_PLATFORM));
    check("Platform Admin scope.platform === true", ctx["p3_pa"]?.scope.platform === true);

    // #9/#10 Org/Clinic admins are denied PLATFORM-level user admin (the migrated
    // /api/users endpoints require platform scope; scoped admin is Phase 4).
    check("#9 Organization Admin denied platform user-admin", deny("p3_org", USERS_MANAGE_PLATFORM));
    check("#10 Clinic Admin denied platform user-admin", deny("p3_clinic", USERS_MANAGE_PLATFORM));
    // …but Org Admin DOES hold users.manage within its org scope (Phase 4 endpoints).
    check("#9 Organization Admin CAN users.manage within own org (scoped)", allow("p3_org", { permissions: ["users.manage"], mode: "all", organizationId: 1 }));
    check("#15 Organization Admin cannot manage another org", deny("p3_org", { permissions: ["organization.manage"], mode: "all", organizationId: 2 }));
    check("#14 Organization Admin manages own org", allow("p3_org", { permissions: ["organization.manage"], mode: "all", organizationId: 1 }));

    // #16/#17 Clinic scope
    check("#16 Clinic Admin manages own clinic", allow("p3_clinic", { permissions: ["clinic.manage"], mode: "all", clinicId: 1 }));
    check("#17 Clinic Admin cannot manage another clinic", deny("p3_clinic", { permissions: ["clinic.manage"], mode: "all", clinicId: 2 }));
    // #18/#19 Platform Admin (platform scope) can manage a clinic in any org.
    check("#18 Platform Admin manages clinic in any org", allow("p3_pa", { permissions: ["clinic.manage"], mode: "all", clinicId: 2 }));

    // #11/#12/#13 PCS/ACS/Investor cannot manage users
    check("#11 PCS cannot manage users", deny("p3_pcs", USERS_MANAGE_PLATFORM) && deny("p3_pcs", { permissions: ["users.manage"], mode: "all" }));
    check("#12 ACS cannot manage users", deny("p3_acs", { permissions: ["users.manage"], mode: "all" }));
    check("#13 Investor cannot manage users", deny("p3_inv", { permissions: ["users.manage"], mode: "all" }));

    // #20/#21 Billing role
    check("#20 Billing role can billing.view/manage", allow("p3_biller", { permissions: ["billing.view"], mode: "all" }) && allow("p3_biller", { permissions: ["billing.manage"], mode: "all" }));
    check("#21 Billing role cannot access platform settings", deny("p3_biller", SETTINGS_MANAGE));
    check("Billing role cannot read audit log", deny("p3_biller", AUDIT_VIEW));

    // #22/#23 Finance Manager
    check("#22 Finance Manager can finance.view", allow("p3_fin", { permissions: ["finance.view"], mode: "all" }));
    check("#23 Finance Manager cannot manage users / settings", deny("p3_fin", USERS_MANAGE_PLATFORM) && deny("p3_fin", SETTINGS_MANAGE));

    // #24 Software Engineer: platform-scoped but NO PHI/clinical capability.
    check("#24 Software Engineer has technical.view", allow("p3_swe", { permissions: ["technical.view"], mode: "all" }));
    check("#24 Software Engineer CANNOT read patients (platform scope ≠ capability)", deny("p3_swe", { permissions: ["patient.read"], mode: "all" }));
    check("#24 Software Engineer cannot manage users", deny("p3_swe", USERS_MANAGE_PLATFORM));

    // #25 Investor: aggregate-only, org-scoped.
    check("#25 Investor cannot billing/settings/patient", deny("p3_inv", { permissions: ["billing.view"], mode: "all" }) && deny("p3_inv", SETTINGS_MANAGE) && deny("p3_inv", { permissions: ["patient.read"], mode: "all" }));
    check("#25 Investor is NOT platform-scoped", ctx["p3_inv"]?.scope.platform === false);

    // #26/#27 Audit
    check("#26 user without audit permission cannot read audit log", deny("p3_pcs", AUDIT_VIEW) && deny("p3_acs", AUDIT_VIEW) && deny("p3_inv", AUDIT_VIEW));
    check("#27 authorized audit viewer (Platform Admin) can read audit log", allow("p3_pa", AUDIT_VIEW));

    // #5 inactive user → denied (401 at decision level)
    check("#5 inactive user is rejected", deny("p3_inactive", USERS_MANAGE_PLATFORM) && ctx["p3_inactive"]?.isActive === false);

    // #6/#31 stale/legacy session.role cannot grant a migrated permission.
    check("#6 legacy role 'admin' with only PCS access CANNOT manage users", deny("p3_fakeadmin", USERS_MANAGE_PLATFORM) && deny("p3_fakeadmin", { permissions: ["users.manage"], mode: "all" }));
    check("#6 legacy 'admin' fakeadmin cannot read audit", deny("p3_fakeadmin", AUDIT_VIEW));

    // #3 deny-wins (resolver math): grant then deny order.sign on PCS-derived user has no order.sign anyway; verify deny-wins on a clinician-like grant via override is covered by Phase 2 harness. Here assert PCS lacks document.sign.
    check("PCS lacks document.sign (role bundle)", deny("p3_pcs", { permissions: ["document.sign"], mode: "all" }));

    console.log(`\n[phase3] ${pass} passed, ${fail} failed`);
  } catch (err: any) {
    console.error("[phase3] FAILED:", err?.message ?? err);
    fail++;
  } finally {
    await pool.end();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
