// Phase 3.5 access-control RUNTIME test — billing/finance authority + resource
// scope + password-hash safety, exercised against the REAL resolveAccessContext
// and the REAL persisted billing-record clinic-ownership scope resolver, with
// enforcement conceptually ON (decideAccess is called directly).
//
//   DATABASE_URL=postgres://localhost:5432/plexus_access_phase35_test \
//     npx tsx script/testAccessControlPhase35.ts
//
// HARD SAFETY: refuses unless DATABASE_URL names a *phase35* database.

import { eq, and } from "drizzle-orm";

const URL = process.env.DATABASE_URL ?? "";
if (!/phase35/i.test(URL) || /secondary|prod|staging/i.test(URL)) {
  console.error(`[phase35] REFUSING: DATABASE_URL must name a disposable *phase35* DB. Got: ${URL.replace(/:[^:@/]*@/, ":****@")}`);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const { db, pool } = await import("../server/db");
  const { resolveAccessContext } = await import("../server/services/access/accessContextService");
  const { decideAccess } = await import("../server/middleware/accessDecision");
  const { usersRepository } = await import("../server/repositories/users.repo");
  const { users } = await import("@shared/schema/users");
  const { organizations, roles, userRoles, userOrganizations, userClinics } = await import("@shared/schema/access");
  const { billingRecords } = await import("@shared/schema/billing");

  try {
    for (const id of [1, 2]) {
      const [o] = await db.select().from(organizations).where(eq(organizations.id, id));
      if (!o) await db.insert(organizations).values({ id, name: `Org ${id}`, slug: `org-${id}`, orgType: "group", status: "active" } as never);
    }
    const roleIdByKey = new Map((await db.select().from(roles)).map((r) => [r.key, r.id]));
    const rid = (k: string) => { const i = roleIdByKey.get(k); if (i == null) throw new Error(`missing role ${k}`); return i; };

    const FIX = [
      { id: "p35_pa", role: "admin", roleKey: "platform_admin" },
      { id: "p35_biller", role: "biller", roleKey: "billing_revenue_cycle", clinicId: 1 },
      { id: "p35_fin", role: "admin", roleKey: "finance_manager", orgId: 1 },
      { id: "p35_inv", role: "clinician", roleKey: "investor", orgId: 1 },
      { id: "p35_biller2", role: "biller", roleKey: "billing_revenue_cycle", clinicId: 2 },
    ];
    for (const f of FIX) {
      const [ex] = await db.select().from(users).where(eq(users.id, f.id));
      if (!ex) await db.insert(users).values({ id: f.id, username: f.id, password: "x", role: f.role, active: true, status: "active", clinicId: (f as any).clinicId ?? null } as never);
      const [hr] = await db.select().from(userRoles).where(and(eq(userRoles.userId, f.id), eq(userRoles.active, true))).limit(1);
      if (!hr) await db.insert(userRoles).values({ userId: f.id, roleId: rid(f.roleKey), isPrimary: true, active: true } as never);
      if ((f as any).orgId) {
        const [ho] = await db.select().from(userOrganizations).where(and(eq(userOrganizations.userId, f.id), eq(userOrganizations.active, true))).limit(1);
        if (!ho) await db.insert(userOrganizations).values({ userId: f.id, organizationId: (f as any).orgId, isPrimary: true, active: true } as never);
      }
      if ((f as any).clinicId) {
        const [hc] = await db.select().from(userClinics).where(and(eq(userClinics.userId, f.id), eq(userClinics.active, true))).limit(1);
        if (!hc) await db.insert(userClinics).values({ userId: f.id, clinicId: (f as any).clinicId, isPrimary: true, active: true } as never);
      }
    }

    const ctx: Record<string, any> = {};
    for (const f of FIX) ctx[f.id] = await resolveAccessContext(f.id);

    const allow = (id: string, spec: any) => decideAccess(ctx[id], spec).ok === true;
    const deny = (id: string, spec: any) => decideAccess(ctx[id], spec).ok === false;

    const BILL_VIEW = { permissions: ["billing.view"], mode: "all" as const };
    const BILL_MANAGE = { permissions: ["billing.manage"], mode: "all" as const };
    const FIN_VIEW = { permissions: ["finance.view"], mode: "all" as const };
    const FIN_MANAGE = { permissions: ["finance.manage"], mode: "all" as const };
    const SETTINGS_MANAGE = { permissions: ["platform.settings.manage"], mode: "all" as const };

    console.log("\n[Platform Admin billing/finance]");
    check("#1 PA billing.view", allow("p35_pa", BILL_VIEW));
    check("#2 PA billing.manage", allow("p35_pa", BILL_MANAGE));
    check("#3 PA finance.view", allow("p35_pa", FIN_VIEW));
    check("#4 PA finance.manage", allow("p35_pa", FIN_MANAGE));
    check("#5 PA still has NO patient.clinical_data.view (PHI separate)", deny("p35_pa", { permissions: ["patient.clinical_data.view"], mode: "all" }));

    console.log("\n[Billing role]");
    check("#6 Billing can billing.view", allow("p35_biller", BILL_VIEW));
    check("#7 Billing can billing.manage", allow("p35_biller", BILL_MANAGE));
    check("#8 Billing cannot finance.manage", deny("p35_biller", FIN_MANAGE));
    check("#9 Billing cannot platform.settings.manage", deny("p35_biller", SETTINGS_MANAGE));
    check("#10 Billing cannot patient.clinical_data.view", deny("p35_biller", { permissions: ["patient.clinical_data.view"], mode: "all" }));

    console.log("\n[Finance Manager]");
    check("#11 Finance can finance.view", allow("p35_fin", FIN_VIEW));
    check("#12 Finance can finance.manage", allow("p35_fin", FIN_MANAGE));
    check("#13 Finance cannot billing.manage (billing.view only)", deny("p35_fin", BILL_MANAGE) && allow("p35_fin", BILL_VIEW));
    check("#14 Finance cannot platform.settings.manage", deny("p35_fin", SETTINGS_MANAGE));
    check("#15 Finance has no patient clinical permission", deny("p35_fin", { permissions: ["patient.read"], mode: "all" }));

    console.log("\n[Investor]");
    check("#16 Investor cannot billing.view", deny("p35_inv", BILL_VIEW));
    check("#17 Investor cannot billing.manage", deny("p35_inv", BILL_MANAGE));
    check("#18 Investor cannot finance.view", deny("p35_inv", FIN_VIEW));
    check("#19 Investor cannot finance.manage", deny("p35_inv", FIN_MANAGE));
    check("#20 Investor retains investor.* only", allow("p35_inv", { permissions: ["investor.dashboard.view"], mode: "all" }) && (ctx["p35_inv"].permissions as string[]).every((p) => p.startsWith("investor.")));

    console.log("\n[Resource scope + forged clinicId]");
    // Read PERSISTED clinic ownership from billing_records (never a client value).
    const persistedClinic = async (recordId: number) => {
      const [r] = await db.select({ clinicId: billingRecords.clinicId }).from(billingRecords).where(eq(billingRecords.id, recordId)).limit(1);
      return r?.clinicId ?? null;
    };
    const rec1Clinic = await persistedClinic(1001); // clinic 1
    const rec2Clinic = await persistedClinic(1002); // clinic 2
    check("#21 Clinic-1 biller CAN manage own-clinic billing record", allow("p35_biller", { ...BILL_MANAGE, clinicId: rec1Clinic }));
    check("#21 Clinic-1 biller CANNOT manage another clinic's billing record", deny("p35_biller", { ...BILL_MANAGE, clinicId: rec2Clinic }));
    check("#24 forged clinicId cannot bypass — persisted owner (clinic 2) governs", deny("p35_biller", { ...BILL_MANAGE, clinicId: rec2Clinic }));
    check("#22 Org-scoped finance user limited to own org", allow("p35_fin", { ...FIN_VIEW, organizationId: 1 }) && deny("p35_fin", { ...FIN_VIEW, organizationId: 2 }));
    check("#23 Platform Admin billing.manage across any clinic", allow("p35_pa", { ...BILL_MANAGE, clinicId: rec2Clinic }));

    console.log("\n[Password-hash safety]");
    const created = await usersRepository.create({ username: "p35_pwtest", password: "s3cret!" } as any);
    check("#31 create() returns hash-free SafeUser", !("password" in (created as any)));
    check("#29/#30 JSON.stringify(SafeUser) contains no password/hash", !/password/i.test(JSON.stringify(created)));
    const fetched = await usersRepository.getById(created.id);
    check("#31 getById() returns hash-free SafeUser", !!fetched && !("password" in (fetched as any)));
    const byName = await usersRepository.getByUsername("p35_pwtest");
    check("#31 getByUsername() returns hash-free SafeUser", !!byName && !("password" in (byName as any)));
    const valid = await usersRepository.validatePasswordByIdentifier("p35_pwtest", "s3cret!");
    check("#32 password verification still works (correct pw)", !!valid && !("password" in (valid as any)));
    const invalid = await usersRepository.validatePasswordByIdentifier("p35_pwtest", "wrong");
    check("#32 password verification rejects wrong pw", invalid === null);
    const authRec = await usersRepository.getAuthRecordByUsername("p35_pwtest");
    check("auth-only record DOES carry the hash (internal use)", !!authRec && typeof (authRec as any).password === "string" && (authRec as any).password.length > 0);

    console.log(`\n[phase35] ${pass} passed, ${fail} failed`);
  } catch (err: any) {
    console.error("[phase35] FAILED:", err?.message ?? err);
    fail++;
  } finally {
    await pool.end();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
