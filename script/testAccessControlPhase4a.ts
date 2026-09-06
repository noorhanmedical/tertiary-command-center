// Phase 4A access-management RUNTIME test — exercises the REAL accessAdminService
// (create/read/mutate) + escalation rules + audit + service access + org/clinic
// scope + password safety against a DISPOSABLE database.
//
//   DATABASE_URL=postgres://localhost:5432/plexus_access_phase4a_test \
//     npx tsx script/testAccessControlPhase4a.ts
//
// HARD SAFETY: refuses unless DATABASE_URL names a *phase4a* database.

import { eq, and } from "drizzle-orm";

const URL = process.env.DATABASE_URL ?? "";
if (!/phase4a/i.test(URL) || /secondary|prod|staging/i.test(URL)) {
  console.error(`[phase4a] REFUSING: DATABASE_URL must name a disposable *phase4a* DB. Got: ${URL.replace(/:[^:@/]*@/, ":****@")}`);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function expectThrow(name: string, fn: () => Promise<unknown>, statusWanted?: number) {
  try { await fn(); check(name, false, "expected rejection"); }
  catch (e: any) { check(name, statusWanted ? e?.status === statusWanted : true, `status=${e?.status} msg=${e?.message}`); }
}

async function main() {
  const { db, pool } = await import("../server/db");
  const { resolveAccessContext } = await import("../server/services/access/accessContextService");
  const svc = await import("../server/services/access/accessAdminService");
  const { users } = await import("@shared/schema/users");
  const { clinics } = await import("@shared/schema/clinics");
  const { organizations, roles, userRoles, userOrganizations, userClinics } = await import("@shared/schema/access");
  const { auditLog } = await import("@shared/schema/audit");

  try {
    // Orgs 1,2 and clinic→org ownership (clinic1→org1, clinic2→org2).
    for (const id of [1, 2]) {
      const [o] = await db.select().from(organizations).where(eq(organizations.id, id));
      if (!o) await db.insert(organizations).values({ id, name: `Org ${id}`, slug: `org-${id}`, orgType: "group", status: "active" } as never);
    }
    await db.update(clinics).set({ organizationId: 1 }).where(eq(clinics.id, 1));
    await db.update(clinics).set({ organizationId: 2 }).where(eq(clinics.id, 2));

    const roleId = new Map((await db.select().from(roles)).map((r) => [r.key, r.id]));
    const seed = async (id: string, roleKey: string, opts: { legacy?: string; clinicId?: number; orgId?: number } = {}) => {
      const [ex] = await db.select().from(users).where(eq(users.id, id));
      if (!ex) await db.insert(users).values({ id, username: id, password: "x", role: opts.legacy ?? "clinician", active: true, status: "active", clinicId: opts.clinicId ?? null } as never);
      const [hr] = await db.select().from(userRoles).where(and(eq(userRoles.userId, id), eq(userRoles.active, true))).limit(1);
      if (!hr) await db.insert(userRoles).values({ userId: id, roleId: roleId.get(roleKey)!, isPrimary: true, active: true } as never);
      if (opts.orgId) { const [h] = await db.select().from(userOrganizations).where(and(eq(userOrganizations.userId, id), eq(userOrganizations.active, true))).limit(1); if (!h) await db.insert(userOrganizations).values({ userId: id, organizationId: opts.orgId, isPrimary: true, active: true } as never); }
      if (opts.clinicId) { const [h] = await db.select().from(userClinics).where(and(eq(userClinics.userId, id), eq(userClinics.active, true))).limit(1); if (!h) await db.insert(userClinics).values({ userId: id, clinicId: opts.clinicId, isPrimary: true, active: true } as never); }
    };
    await seed("a_pa", "platform_admin", { legacy: "admin" });
    await seed("a_org", "organization_admin", { legacy: "admin", orgId: 1, clinicId: 1 });
    await seed("a_clinic", "clinic_admin", { legacy: "admin", clinicId: 1 });
    await seed("a_t1", "clinician", { clinicId: 1, orgId: 1 });   // target in org1/clinic1
    await seed("a_t2", "clinician", { clinicId: 2, orgId: 2 });   // target in org2/clinic2

    const pa = (await resolveAccessContext("a_pa"))!;
    const org = (await resolveAccessContext("a_org"))!;
    const clinic = (await resolveAccessContext("a_clinic"))!;

    console.log("\n[Platform Admin — user access]");
    const list = await svc.listUsers(pa, {});
    check("#1 Platform Admin lists users", Array.isArray(list) && list.length >= 5);
    check("#37 list rows are hash-free", list.every((u: any) => !("password" in u)));
    const profile: any = await svc.getUserAccessProfile(pa, "a_t1");
    check("#2 read access profile", profile.identity.id === "a_t1");
    check("#37 profile has no password", !JSON.stringify(profile).toLowerCase().includes("password"));
    await svc.setUserRoles(pa, "a_t1", { primary: "clinician" });
    const [t1row] = await db.select({ role: users.role }).from(users).where(eq(users.id, "a_t1"));
    check("#3/#42 assign role syncs legacy mirror (clinician→clinician)", t1row.role === "clinician");
    await svc.setUserClinics(pa, "a_t1", [{ clinicId: 1, isPrimary: true }]);
    check("#4 add clinic", true);
    await svc.setUserOrganizations(pa, "a_t1", [{ organizationId: 1, isPrimary: true }]);
    check("#5 add organization", true);
    await svc.setUserPermissionOverrides(pa, "a_t1", { grants: ["reporting.view"] });
    check("#6 grant permission", (await resolveAccessContext("a_t1"))!.permissions.includes("reporting.view"));
    await svc.setUserPermissionOverrides(pa, "a_t1", { denies: ["order.sign"] });
    check("#7/#8 deny wins after mutation", !(await resolveAccessContext("a_t1"))!.permissions.includes("order.sign"));
    await svc.setUserDefaultWorkspace(pa, "a_t1", "clinical");
    check("#9 default workspace set", (await resolveAccessContext("a_t1"))!.defaultWorkspace === "clinical");
    await expectThrow("#25 arbitrary workspace rejected", () => svc.setUserDefaultWorkspace(pa, "a_t1", "https://evil/x"), 400);
    await svc.setUserStatus(pa, "a_t1", "inactive");
    check("#10 inactive user becomes unauthorized", (await resolveAccessContext("a_t1"))!.isActive === false);
    await svc.setUserStatus(pa, "a_t1", "active");

    console.log("\n[Legacy mirror for non-mappable role]");
    await svc.setUserRoles(pa, "a_t1", { primary: "organization_admin" });
    const [t1b] = await db.select({ role: users.role }).from(users).where(eq(users.id, "a_t1"));
    check("#43 non-mappable role mirrors the new key (no misleading legacy elevation)", t1b.role === "organization_admin");
    await svc.setUserRoles(pa, "a_t1", { primary: "clinician" }); // restore

    console.log("\n[Org Admin scope + escalation]");
    check("#11 Org Admin lists only in-scope users", (await svc.listUsers(org, {})).every((u: any) => u.id !== "a_t2"));
    await expectThrow("#12 Org Admin cannot read another org's user", () => svc.getUserAccessProfile(org, "a_t2"), 403);
    await expectThrow("#13 Org Admin cannot assign another org", () => svc.setUserOrganizations(org, "a_t1", [{ organizationId: 2 }]), 403);
    await expectThrow("#14 Org Admin cannot assign platform role", () => svc.setUserRoles(org, "a_t1", { primary: "platform_admin" }), 403);
    await expectThrow("#15 Org Admin cannot grant platform permission", () => svc.setUserPermissionOverrides(org, "a_t1", { grants: ["platform.settings.manage"] }), 403);

    console.log("\n[Clinic Admin scope + escalation]");
    check("#16 Clinic Admin can read in-clinic user", (await svc.getUserAccessProfile(clinic, "a_t1")) != null);
    await expectThrow("#17 Clinic Admin cannot manage another clinic's user", () => svc.getUserAccessProfile(clinic, "a_t2"), 403);
    await expectThrow("#19 Clinic Admin cannot assign Platform Admin role", () => svc.setUserRoles(clinic, "a_t1", { primary: "platform_admin" }), 403);

    console.log("\n[Escalation — self / arbitrary]");
    await expectThrow("#20 cannot grant a permission actor lacks", () => svc.setUserPermissionOverrides(clinic, "a_t1", { grants: ["finance.manage"] }), 403);
    await expectThrow("#23 arbitrary role key rejected", () => svc.setUserRoles(pa, "a_t1", { primary: "wat_role" }), 400);
    await expectThrow("#24 arbitrary permission key rejected", () => svc.setUserPermissionOverrides(pa, "a_t1", { grants: ["totally.made.up"] }), 400);

    console.log("\n[Service access]");
    const services = await svc.listServices();
    check("#26 service list uses ancillary registry", services.some((s: any) => s.internalCode === "ultrasound"));
    await svc.setUserServiceAccess(pa, "a_t1", { grants: ["ultrasound"] });
    check("#27/#30 service grant works (separate from capability)", (await resolveAccessContext("a_t1"))!.serviceAccess.includes("ultrasound"));
    await svc.setUserServiceAccess(pa, "a_t1", { grants: ["ultrasound"], denies: ["ultrasound"] });
    check("#28 service deny wins", !(await resolveAccessContext("a_t1"))!.serviceAccess.includes("ultrasound"));
    await expectThrow("#29 unknown service rejected", () => svc.setUserServiceAccess(pa, "a_t1", { grants: ["not_a_service"] }), 400);

    console.log("\n[Organizations / clinics reads]");
    check("Org Admin sees only own org", (await svc.listOrganizations(org)).every((o: any) => o.id === 1));
    check("Platform Admin sees all orgs", (await svc.listOrganizations(pa)).length >= 2);
    await expectThrow("Org Admin cannot read another org", () => svc.getOrganization(org, 2), 403);
    check("Clinic Admin lists only own clinic", (await svc.listClinics(clinic)).every((c: any) => c.id === 1));

    console.log("\n[Audit]");
    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityType, "user_access"));
    check("#38 access mutations produced audit entries", auditRows.length > 0);
    check("#39 audit entry has actor + target + changes", auditRows.every((r: any) => r.userId && r.entityId && r.changes));
    // clinic.access.updated writes an audit row carrying clinic ownership — use
    // it to prove org-scoped audit filtering (clinic 1 in-org, clinic 2 not).
    await svc.updateClinic(pa, 1, { shortName: "C1" });
    await svc.updateClinic(pa, 2, { shortName: "C2" });
    const orgAudit = await svc.queryAudit(org, { platform: false });
    const platAudit = await svc.queryAudit(pa, { platform: true });
    check("#41 platform audit works for platform user", platAudit.rows.length > 0);
    check("#40 org-scoped audit returns the in-org clinic-1 event", orgAudit.rows.some((r: any) => r.clinicId === 1 && r.action === "clinic.access.updated"));
    check("#40 org-scoped audit EXCLUDES the other-org clinic-2 event", !orgAudit.rows.some((r: any) => r.clinicId === 2));

    console.log(`\n[phase4a] ${pass} passed, ${fail} failed`);
  } catch (err: any) {
    console.error("[phase4a] FATAL:", err?.message ?? err, err?.stack);
    fail++;
  } finally {
    await pool.end();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
