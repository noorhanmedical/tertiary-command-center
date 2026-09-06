// Seed the Plexus OS access-control SYSTEM defaults: the permission catalog,
// the system role templates, and each role's default permission bundle.
//
// Run with `npm run seed:access-control`. Requires DATABASE_URL.
//
// IDEMPOTENT + NON-DESTRUCTIVE:
//   • Permissions/roles are upserted by their stable key.
//   • Role→permission bundles are reconciled to match the catalog (adds
//     missing links; leaves any admin-added extras untouched).
//   • System roles are marked is_system=true.
//   • This seeds DEFAULTS only. It never assigns roles to users and never
//     touches existing user rows — user configuration is owned by Settings.
//
// Safe to run repeatedly (e.g. after each deploy) to converge system defaults.

import { eq, and, sql } from "drizzle-orm";
import {
  PERMISSION_CATALOG,
  ROLE_CATALOG,
} from "@shared/accessControl/catalog";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed:access-control] DATABASE_URL is not set");
    process.exit(1);
  }
  const { db, pool } = await import("../server/db");
  const { permissions, roles, rolePermissions } = await import("@shared/schema/access");

  let exitCode = 0;
  try {
    // ── 1. Permissions ────────────────────────────────────────────────────
    let permInserted = 0;
    let permUpdated = 0;
    for (const p of PERMISSION_CATALOG) {
      const [existing] = await db.select().from(permissions).where(eq(permissions.key, p.key));
      if (!existing) {
        await db.insert(permissions).values({ key: p.key, category: p.category, description: p.description });
        permInserted++;
      } else if (existing.category !== p.category || existing.description !== p.description) {
        await db.update(permissions)
          .set({ category: p.category, description: p.description })
          .where(eq(permissions.id, existing.id));
        permUpdated++;
      }
    }
    console.log(`[seed:access-control] permissions: +${permInserted} inserted, ${permUpdated} updated (${PERMISSION_CATALOG.length} total)`);

    // Build a key→id map for permissions.
    const allPerms = await db.select().from(permissions);
    const permIdByKey = new Map(allPerms.map((p) => [p.key, p.id]));

    // ── 2. Roles (system, global — organization_id NULL) ───────────────────
    let roleInserted = 0;
    let roleUpdated = 0;
    for (const r of ROLE_CATALOG) {
      const [existing] = await db.select().from(roles)
        .where(and(eq(roles.key, r.key), sql`organization_id IS NULL`));
      const values = {
        key: r.key,
        displayName: r.displayName,
        description: r.description,
        scopeType: r.scopeType,
        defaultWorkspace: r.defaultWorkspace,
        isSystem: true,
        isAssignable: r.isAssignable ?? true,
      };
      if (!existing) {
        await db.insert(roles).values(values);
        roleInserted++;
      } else {
        await db.update(roles)
          .set({
            displayName: values.displayName,
            description: values.description,
            scopeType: values.scopeType,
            defaultWorkspace: values.defaultWorkspace,
            isSystem: true,
            isAssignable: values.isAssignable,
            updatedAt: new Date(),
          })
          .where(eq(roles.id, existing.id));
        roleUpdated++;
      }
    }
    console.log(`[seed:access-control] roles: +${roleInserted} inserted, ${roleUpdated} updated (${ROLE_CATALOG.length} total)`);

    // Build a key→id map for global system roles.
    const allRoles = await db.select().from(roles).where(sql`organization_id IS NULL`);
    const roleIdByKey = new Map(allRoles.map((r) => [r.key, r.id]));

    // ── 3. Role → permission bundles ────────────────────────────────────────
    let linkInserted = 0;
    for (const r of ROLE_CATALOG) {
      const roleId = roleIdByKey.get(r.key);
      if (roleId == null) {
        console.warn(`[seed:access-control] role ${r.key} not found after upsert — skipping bundle`);
        continue;
      }
      // Existing links for this role.
      const existingLinks = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const existingPermIds = new Set(existingLinks.map((l) => l.permissionId));

      for (const permKey of r.permissions) {
        const permId = permIdByKey.get(permKey);
        if (permId == null) {
          console.warn(`[seed:access-control] permission ${permKey} (role ${r.key}) missing from catalog table — skipping`);
          continue;
        }
        if (!existingPermIds.has(permId)) {
          await db.insert(rolePermissions).values({ roleId, permissionId: permId });
          linkInserted++;
        }
      }
      // NOTE: intentionally does NOT delete extra links an admin may have added.
      // Seeds converge defaults; they don't strip admin customization.
    }
    console.log(`[seed:access-control] role_permissions: +${linkInserted} links inserted`);

    console.log("[seed:access-control] done.");
  } catch (err: any) {
    console.error("[seed:access-control] FAILED:", err?.message ?? err);
    exitCode = 1;
  } finally {
    await pool.end();
    process.exit(exitCode);
  }
}

main();
