// Phase 0-2 acceptance harness for the access-control work.
// Run against the DISPOSABLE plexus_accesstest DB (already migrated, seeded,
// and backfilled). Exercises resolveAccessContext + the login identifier
// resolver + permission override math. NOT a production script.
//
//   DATABASE_URL=postgres://localhost:5432/plexus_accesstest npx tsx script/testAccessControlPhase2.ts

import { eq, and } from "drizzle-orm";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
  const { db, pool } = await import("../server/db");
  const { resolveAccessContext, hasPermission, isClinicInScope } =
    await import("../server/services/access/accessContextService");
  const { users } = await import("@shared/schema/users");
  const { usersRepository } = await import("../server/repositories/users.repo");
  const { permissions, userPermissionOverrides, userServiceAccess, userClinics } =
    await import("@shared/schema/access");
  const bcrypt = (await import("bcryptjs")).default;

  try {
    // ── Role resolution ───────────────────────────────────────────────────
    console.log("\n[Role resolution]");
    const admin = await resolveAccessContext("u_admin");
    check("Platform Admin resolves platform scope", !!admin?.scope.platform);
    check("Platform Admin has organization.manage", hasPermission(admin, "organization.manage"));
    check("Platform Admin has users.manage", hasPermission(admin, "users.manage"));

    const doc = await resolveAccessContext("u_doc");
    check("Clinician resolves", doc?.roles.some((r) => r.key === "clinician") ?? false);
    check("Clinician has order.sign", hasPermission(doc, "order.sign"));
    check("Clinician is NOT platform-scoped", !doc?.scope.platform);
    check("Clinician default workspace = clinical", doc?.defaultWorkspace === "clinical");

    const tech = await resolveAccessContext("u_tech");
    check("Ancillary Technician resolves", tech?.roles.some((r) => r.key === "ancillary_technician") ?? false);
    check("Technician has procedure.perform", hasPermission(tech, "procedure.perform"));
    check("Technician does NOT have order.sign", !hasPermission(tech, "order.sign"));

    const bill = await resolveAccessContext("u_bill");
    check("Billing/Revenue Cycle resolves", bill?.roles.some((r) => r.key === "billing_revenue_cycle") ?? false);
    check("Billing has billing.manage", hasPermission(bill, "billing.manage"));

    const rev = await resolveAccessContext("u_rev");
    check("plexus_internal_clinical_reviewer → plexus_clinical_reviewer", rev?.roles.some((r) => r.key === "plexus_clinical_reviewer") ?? false);
    check("Reviewer has screening.admin_review (behavior preserved)", hasPermission(rev, "screening.admin_review"));

    const pcs = await resolveAccessContext("u_liaison_pcs");
    check("Ambiguous liaison + PCS team → pcs role", pcs?.roles.some((r) => r.key === "pcs") ?? false);
    check("PCS has communication.manage", hasPermission(pcs, "communication.manage"));
    check("PCS does NOT have document.sign", !hasPermission(pcs, "document.sign"));

    const acs = await resolveAccessContext("u_liaison_acs");
    check("Ambiguous liaison + ACS team → acs role", acs?.roles.some((r) => r.key === "acs") ?? false);
    check("ACS has screening.qualify", hasPermission(acs, "screening.qualify"));
    check("ACS does NOT have order.sign", !hasPermission(acs, "order.sign"));

    const flagged = await resolveAccessContext("u_liaison_none");
    check("Ambiguous liaison + no team → neutral patient_support (no silent guess)", flagged?.roles.some((r) => r.key === "patient_support") ?? false);
    check("Flagged liaison is NOT pcs/acs", !flagged?.roles.some((r) => r.key === "pcs" || r.key === "acs"));

    // ── Scope ───────────────────────────────────────────────────────────────
    console.log("\n[Scope]");
    check("Clinician clinic scope includes legacy clinic 1", doc?.scope.clinicIds.includes(1) ?? false);
    check("Clinician org scope includes an org", (doc?.scope.organizationIds.length ?? 0) > 0);
    check("Clinician (non-platform) cannot see clinic 999", !isClinicInScope(doc, 999));
    check("Clinician can see own clinic 1 via scope", isClinicInScope(doc, 1));
    check("Platform Admin sees ANY clinic", isClinicInScope(admin, 999));

    // Multi-clinic: add clinic 2 to the clinician.
    const [c2] = await db.select().from(userClinics)
      .where(and(eq(userClinics.userId, "u_doc"), eq(userClinics.clinicId, 2)));
    if (!c2) await db.insert(userClinics).values({ userId: "u_doc", clinicId: 2, isPrimary: false, active: true });
    const docMulti = await resolveAccessContext("u_doc");
    check("Multi-clinic scope resolves both clinics 1 and 2",
      !!(docMulti?.scope.clinicIds.includes(1) && docMulti?.scope.clinicIds.includes(2)),
      `got ${JSON.stringify(docMulti?.scope.clinicIds)}`);

    // ── Permission overrides ─────────────────────────────────────────────────
    console.log("\n[Permission overrides]");
    const [reportingPerm] = await db.select().from(permissions).where(eq(permissions.key, "reporting.view"));
    const before = await resolveAccessContext("u_doc");
    check("Clinician lacks reporting.view before grant", !hasPermission(before, "reporting.view"));
    const [existGrant] = await db.select().from(userPermissionOverrides)
      .where(and(eq(userPermissionOverrides.userId, "u_doc"), eq(userPermissionOverrides.permissionId, reportingPerm.id)));
    if (!existGrant) await db.insert(userPermissionOverrides).values({ userId: "u_doc", permissionId: reportingPerm.id, effect: "grant", active: true });
    const afterGrant = await resolveAccessContext("u_doc");
    check("GRANT override adds reporting.view", hasPermission(afterGrant, "reporting.view"));

    const [orderSignPerm] = await db.select().from(permissions).where(eq(permissions.key, "order.sign"));
    check("Clinician has order.sign from role before deny", hasPermission(afterGrant, "order.sign"));
    const [existDeny] = await db.select().from(userPermissionOverrides)
      .where(and(eq(userPermissionOverrides.userId, "u_doc"), eq(userPermissionOverrides.permissionId, orderSignPerm.id)));
    if (!existDeny) await db.insert(userPermissionOverrides).values({ userId: "u_doc", permissionId: orderSignPerm.id, effect: "deny", active: true });
    const afterDeny = await resolveAccessContext("u_doc");
    check("DENY override removes role-granted order.sign (deny wins)", !hasPermission(afterDeny, "order.sign"));

    // ── Service access ────────────────────────────────────────────────────────
    console.log("\n[Service access]");
    const [existSvc] = await db.select().from(userServiceAccess)
      .where(and(eq(userServiceAccess.userId, "u_tech"), eq(userServiceAccess.serviceCode, "ultrasound")));
    if (!existSvc) await db.insert(userServiceAccess).values({ userId: "u_tech", serviceCode: "ultrasound", effect: "grant", active: true });
    const techSvc = await resolveAccessContext("u_tech");
    check("User service grant resolves (ultrasound)", techSvc?.serviceAccess.includes("ultrasound") ?? false);

    // ── Deactivation enforcement ───────────────────────────────────────────────
    console.log("\n[Deactivation]");
    const ghost = await resolveAccessContext("u_inactive");
    check("Inactive user resolves isActive=false", ghost?.isActive === false);
    check("Inactive user has EMPTY permissions", (ghost?.permissions.length ?? -1) === 0);
    check("Inactive user has EMPTY roles", (ghost?.roles.length ?? -1) === 0);

    await db.update(users).set({ active: false, status: "inactive" }).where(eq(users.id, "u_bill"));
    const billDisabled = await resolveAccessContext("u_bill");
    check("Deactivated-mid-session user loses all permissions immediately", (billDisabled?.permissions.length ?? -1) === 0);
    await db.update(users).set({ active: true, status: "active" }).where(eq(users.id, "u_bill"));

    // ── Secret hygiene ─────────────────────────────────────────────────────────
    console.log("\n[Secret hygiene]");
    const ctxJson = JSON.stringify(await resolveAccessContext("u_admin"));
    check("Access context contains no 'password' field", !ctxJson.toLowerCase().includes("password"));
    check("Access context contains no bcrypt hash", !ctxJson.includes("$2"));

    // ── Login identifier resolution (email + username) ─────────────────────────
    console.log("\n[Login identifier resolution]");
    const hash = await bcrypt.hash("secret123", 12);
    await db.update(users).set({ password: hash }).where(eq(users.id, "u_admin"));
    const byUsername = await usersRepository.validatePasswordByIdentifier("admin", "secret123");
    check("Login by username works", byUsername?.id === "u_admin");
    const byEmail = await usersRepository.validatePasswordByIdentifier("ADMIN@plexus.test", "secret123");
    check("Login by email works (case-insensitive)", byEmail?.id === "u_admin");
    const badPw = await usersRepository.validatePasswordByIdentifier("admin@plexus.test", "wrong");
    check("Bad password returns null", badPw === null);
    const unknown = await usersRepository.validatePasswordByIdentifier("nobody@nowhere.test", "secret123");
    check("Unknown identifier returns null (no disclosure)", unknown === null);

  } catch (e: any) {
    fail++;
    console.error("HARNESS ERROR:", e?.stack ?? e?.message ?? e);
  } finally {
    console.log(`\n${fail === 0 ? "ALL PASSED" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
