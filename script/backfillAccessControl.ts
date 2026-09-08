// Backfill existing users/clinics into the Plexus OS access-control model.
//
// Run with `npm run backfill:access-control`. Requires DATABASE_URL.
// PREREQUISITES: migration 0079 applied AND `npm run seed:access-control` run
// (roles/permissions must exist first).
//
// IDEMPOTENT + NON-DESTRUCTIVE:
//   • Never deletes or rewrites legacy data. users.role and users.clinic_id
//     are left intact as mirrors.
//   • Skips any user that already has an ACTIVE user_roles row (safe re-run).
//   • Adds:
//       - user_roles from LEGACY_ROLE_MAPPINGS
//       - user_clinics from the legacy users.clinic_id (primary)
//       - user_organizations ONLY when the user's clinic already belongs to a
//         known organization (clinic.organization_id IS NOT NULL). When the
//         clinic has no organization, NO org membership is invented — the user
//         continues to operate on CLINIC scope. This is production-safe.
//
//   PRODUCTION-SAFE ORGANIZATION BEHAVIOR (default):
//       - Never creates a synthetic "Default Organization".
//       - Never groups unrelated clinics under one fake organization.
//       - Leaves clinics.organization_id NULL when the relationship is unknown.
//
//   DEV/TEST ONLY (opt-in via `--with-default-org`):
//       - Creates a "Default Organization", points orphan clinics at it, and
//         assigns users a primary membership to it. Use ONLY for disposable
//         test/local fixtures — NEVER against real/shared data.
//   • AMBIGUOUS legacy `liaison` is NEVER silently guessed as PCS/ACS:
//       - resolved from CANONICAL team membership (PCS team → pcs, ACS → acs)
//       - otherwise assigned the neutral `patient_support` role AND flagged in
//         the audit log for manual review.
//   • Every action writes an audit_log access event.
//
// DRY-RUN: pass `--dry-run` to log intended changes without writing.

import { eq, and, sql } from "drizzle-orm";
import { LEGACY_ROLE_MAPPINGS } from "@shared/accessControl/catalog";
import { classifyLiaisonMemberships, type LiaisonDecision } from "@shared/accessControl/liaisonClassifier";

const DRY_RUN = process.argv.includes("--dry-run");
// Opt-in ONLY for disposable tests / local fixtures. When absent (the default,
// i.e. production-safe), the backfill NEVER creates a synthetic organization
// and leaves unknown clinic→org relationships as NULL.
const SEED_DEFAULT_ORG = process.argv.includes("--with-default-org");

const DEFAULT_ORG_NAME = "Default Organization";
const DEFAULT_ORG_SLUG = "default-org";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[backfill:access-control] DATABASE_URL is not set");
    process.exit(1);
  }
  const { db, pool } = await import("../server/db");
  const { users } = await import("@shared/schema/users");
  const { clinics } = await import("@shared/schema/clinics");
  const { teams, teamMemberships } = await import("@shared/schema/teams");
  const { auditLog } = await import("@shared/schema/audit");
  const {
    organizations, roles, userRoles, userOrganizations, userClinics,
  } = await import("@shared/schema/access");

  const log = (msg: string) => console.log(`[backfill:access-control]${DRY_RUN ? " (dry-run)" : ""} ${msg}`);

  let exitCode = 0;
  try {
    // ── 0. Preconditions: roles must be seeded ────────────────────────────
    const allRoles = await db.select().from(roles).where(sql`organization_id IS NULL`);
    const roleIdByKey = new Map(allRoles.map((r) => [r.key, r.id]));
    if (roleIdByKey.size === 0) {
      console.error("[backfill:access-control] No roles found. Run `npm run seed:access-control` first.");
      process.exit(1);
    }

    // ── 1. Default Organization — OPT-IN (dev/test only) ──────────────────
    // Production-safe default: do NOT create any synthetic organization and do
    // NOT touch clinic→org relationships. Only under --with-default-org do we
    // create a Default Organization and adopt orphan clinics (disposable data).
    let defaultOrgId = -1;
    if (SEED_DEFAULT_ORG) {
      let [defaultOrg] = await db.select().from(organizations).where(eq(organizations.slug, DEFAULT_ORG_SLUG));
      if (!defaultOrg) {
        if (!DRY_RUN) {
          [defaultOrg] = await db.insert(organizations)
            .values({ name: DEFAULT_ORG_NAME, slug: DEFAULT_ORG_SLUG, orgType: "group", status: "active" })
            .returning();
        }
        log(`[--with-default-org] created Default Organization (slug=${DEFAULT_ORG_SLUG})`);
      } else {
        log(`[--with-default-org] Default Organization exists (id=${defaultOrg.id})`);
      }
      defaultOrgId = defaultOrg?.id ?? -1;

      const orphanClinics = await db.select().from(clinics).where(sql`organization_id IS NULL`);
      log(`[--with-default-org] clinics without organization: ${orphanClinics.length} (adopting into Default Organization)`);
      if (!DRY_RUN && defaultOrgId > 0 && orphanClinics.length > 0) {
        await db.update(clinics)
          .set({ organizationId: defaultOrgId })
          .where(sql`organization_id IS NULL`);
      }
    } else {
      log("production-safe mode: NOT creating a Default Organization; unknown clinic→org relationships remain NULL.");
    }

    // ── 1b. Clinic → organization map (post any opt-in adoption above) ─────
    // Used to DERIVE org membership from a KNOWN clinic relationship only.
    const clinicRows = await db.select().from(clinics);
    const orgByClinicId = new Map<number, number | null>(
      clinicRows.map((c) => [c.id, (c as { organizationId?: number | null }).organizationId ?? null]),
    );

    // ── 3. Per-user backfill ──────────────────────────────────────────────
    const allUsers = await db.select().from(users);
    log(`users to consider: ${allUsers.length}`);

    let rolesAssigned = 0;
    let ambiguousFlagged = 0;
    let skipped = 0;
    let clinicsLinked = 0;
    let orgsLinked = 0;

    for (const u of allUsers) {
      // Idempotency: skip users that already have an ACTIVE role assignment.
      const [existingRole] = await db.select().from(userRoles)
        .where(and(eq(userRoles.userId, u.id), eq(userRoles.active, true)))
        .limit(1);
      if (existingRole) { skipped++; continue; }

      const legacyRole = u.role ?? "clinician";
      const mapping = LEGACY_ROLE_MAPPINGS.find((m) => m.legacy === legacyRole);

      let targetRoleKey: string;
      let ambiguousNote: string | null = null;

      if (mapping && !mapping.ambiguous && mapping.target) {
        targetRoleKey = mapping.target;
      } else if (mapping && mapping.ambiguous) {
        // Resolve ambiguity from CANONICAL team membership — never a guess and
        // never dependent on query row order.
        const decision = await classifyLiaisonFromTeams(db, teams, teamMemberships, u.id);
        if (decision.role) {
          targetRoleKey = decision.role;
        } else {
          targetRoleKey = "patient_support";
          ambiguousNote =
            decision.reason === "conflict"
              ? `Legacy role "${legacyRole}" had CONFLICTING PCS and ACS team memberships with no unambiguous ` +
                `authoritative primary team. Assigned neutral "patient_support" — MANUAL REVIEW REQUIRED to ` +
                `choose PCS or ACS.`
              : `Legacy role "${legacyRole}" is ambiguous and no PCS/ACS team membership was found. ` +
                `Assigned neutral "patient_support" — MANUAL REVIEW REQUIRED to set the correct role.`;
        }
      } else {
        // Unknown legacy role → conservative neutral role + flag.
        targetRoleKey = "patient_support";
        ambiguousNote =
          `Legacy role "${legacyRole}" has no mapping. Assigned neutral "patient_support" — MANUAL REVIEW REQUIRED.`;
      }

      const roleId = roleIdByKey.get(targetRoleKey);
      if (roleId == null) {
        console.warn(`[backfill:access-control] target role "${targetRoleKey}" missing (user ${u.id}) — skipping`);
        continue;
      }

      log(`user ${u.username} (${u.id}): legacy "${legacyRole}" → role "${targetRoleKey}"${ambiguousNote ? " [FLAGGED]" : ""}`);

      // Organization membership is DERIVED from a KNOWN clinic→org link only.
      // If the clinic has no organization, we invent nothing (clinic scope
      // carries the user). Under --with-default-org, fall back to the Default
      // Organization for disposable test data.
      const clinicOrgId = u.clinicId != null ? (orgByClinicId.get(u.clinicId) ?? null) : null;
      const targetOrgId = clinicOrgId ?? (SEED_DEFAULT_ORG && defaultOrgId > 0 ? defaultOrgId : null);

      if (!DRY_RUN) {
        // 3a. Primary role assignment.
        await db.insert(userRoles).values({ userId: u.id, roleId, isPrimary: true, active: true });

        // 3b. Primary organization membership — ONLY when derivable from a
        // known clinic→org relationship (or the opt-in Default Organization).
        // When unknown, NO membership is invented; the user keeps clinic scope.
        if (targetOrgId != null) {
          const [existingOrg] = await db.select().from(userOrganizations)
            .where(and(eq(userOrganizations.userId, u.id), eq(userOrganizations.organizationId, targetOrgId), eq(userOrganizations.active, true)))
            .limit(1);
          if (!existingOrg) {
            await db.insert(userOrganizations).values({ userId: u.id, organizationId: targetOrgId, isPrimary: true, active: true });
            orgsLinked++;
          }
        }

        // 3c. Clinic assignment from the legacy single clinic_id (primary).
        if (u.clinicId != null) {
          const [existingClinic] = await db.select().from(userClinics)
            .where(and(eq(userClinics.userId, u.id), eq(userClinics.clinicId, u.clinicId), eq(userClinics.active, true)))
            .limit(1);
          if (!existingClinic) {
            await db.insert(userClinics).values({ userId: u.id, clinicId: u.clinicId, isPrimary: true, active: true });
            clinicsLinked++;
          }
        }

        // 3d. Audit event.
        await db.insert(auditLog).values({
          clinicId: u.clinicId ?? null,
          userId: u.id,
          username: u.username,
          action: ambiguousNote ? "user.role.backfill.flagged" : "user.role.backfill",
          entityType: "user_access",
          entityId: u.id,
          changes: {
            legacyRole,
            assignedRole: targetRoleKey,
            primaryOrganizationId: targetOrgId,
            organizationSource:
              clinicOrgId != null ? "clinic" : (targetOrgId != null ? "default-org(opt-in)" : "none(clinic-scope)"),
            primaryClinicId: u.clinicId ?? null,
            ambiguous: !!ambiguousNote,
            note: ambiguousNote ?? "Direct legacy→role mapping.",
          },
        });
      }

      rolesAssigned++;
      if (ambiguousNote) ambiguousFlagged++;
    }

    log("─────────────────────────────────────────────");
    log(`roles assigned:      ${rolesAssigned}`);
    log(`ambiguous flagged:   ${ambiguousFlagged}  (assigned patient_support, need manual review)`);
    log(`already had a role:  ${skipped} (skipped)`);
    log(`org memberships:     +${orgsLinked}`);
    log(`clinic assignments:  +${clinicsLinked}`);
    log("done.");
    if (ambiguousFlagged > 0) {
      log(`ACTION REQUIRED: ${ambiguousFlagged} user(s) flagged. Query: SELECT * FROM audit_log WHERE action='user.role.backfill.flagged';`);
    }
  } catch (err: any) {
    console.error("[backfill:access-control] FAILED:", err?.message ?? err);
    exitCode = 1;
  } finally {
    await pool.end();
    process.exit(exitCode);
  }
}

/**
 * Fetch a user's active team memberships and classify the ambiguous legacy
 * `liaison` role via the pure, order-independent classifier. Never guesses:
 * a genuine PCS+ACS conflict returns { role: null, reason: "conflict" } so the
 * caller assigns a neutral role and flags for manual review.
 */
async function classifyLiaisonFromTeams(
  db: any,
  teams: any,
  teamMemberships: any,
  userId: string,
): Promise<LiaisonDecision> {
  const memberships = await db
    .select({ teamType: teams.type, primaryTeam: teamMemberships.primaryTeam })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.active, true)));

  return classifyLiaisonMemberships(memberships);
}

main();
