// ═══════════════════════════════════════════════════════════════════════════
// AccessContextService — the authoritative resolver for "what is this user
// allowed to do", derived entirely from the database.
//
// The SESSION establishes identity (which user id). This service establishes
// AUTHORIZATION. A stale session.role can NEVER override the DB-derived role,
// and a disabled/suspended account resolves to "no access" immediately —
// without waiting for the user to log out.
//
// Effective permissions =
//     (permissions from all ACTIVE assigned roles)
//   ∪ (ACTIVE user permission GRANT overrides)
//   ∖ (ACTIVE user permission DENY overrides)          ← deny ALWAYS wins
//
// Scope (which orgs/clinics) is resolved separately from capability. The
// returned context NEVER contains a password hash.
// ═══════════════════════════════════════════════════════════════════════════

import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema/users";
import {
  roles, permissions, rolePermissions, userRoles,
  userPermissionOverrides, userOrganizations, userClinics,
  roleServiceAccess, userServiceAccess,
  type AccessScopeType,
} from "@shared/schema/access";

// ─── Public shape returned to callers / the client ──────────────────────────
// Contains NO password, NO hash. Safe to serialize to the authenticated user.
export interface AccessContextRole {
  key: string;
  displayName: string;
  scopeType: AccessScopeType;
  defaultWorkspace: string;
  isPrimary: boolean;
}

export interface AccessContext {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  jobTitle: string | null;
  /** active | inactive | suspended — the authoritative account state. */
  accountStatus: string;
  /** Convenience boolean: true only when accountStatus === "active". */
  isActive: boolean;
  roles: AccessContextRole[];
  /** Sorted, de-duplicated effective permission keys (deny already applied). */
  permissions: string[];
  scope: {
    /** True when any active role is platform-scoped (e.g. Platform Admin). */
    platform: boolean;
    organizationIds: number[];
    clinicIds: number[];
  };
  /** Ancillary service internal_codes the user may act on (deny applied). */
  serviceAccess: string[];
  /** Controlled workspace identifier the client maps to a landing route. */
  defaultWorkspace: string;
  lastLoginAt: string | null;
  /**
   * DB-fresh legacy mirrors of `users.role` / `users.clinicId`. These exist
   * ONLY for transition-era backward compatibility (frontend AdminGuard/
   * RoleGuard + legacy backend middleware still read a single role string).
   * They are read straight from the current user row so a changed legacy role
   * is reflected without re-login — NOT synthesized from the new roles[].
   * Authorization authority is `permissions` / `roles`, not these fields.
   */
  legacyRole: string | null;
  legacyClinicId: number | null;
}

/**
 * Resolve the full access context for a user id. Returns null when the user
 * does not exist. When the account is not active, the returned context has
 * isActive=false and EMPTY roles/permissions/scope/serviceAccess — callers
 * MUST treat a non-active context as no-access.
 */
export async function resolveAccessContext(userId: string): Promise<AccessContext | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;

  // Authoritative account state. Legacy `active` boolean and the newer
  // `status` column are reconciled: either being non-active denies access.
  const status = (user.status ?? (user.active ? "active" : "inactive")) as string;
  const isActive = status === "active" && user.active !== false;

  const baseIdentity = {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    jobTitle: user.jobTitle ?? null,
    accountStatus: status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    // DB-fresh legacy mirrors (transition-era compatibility only).
    legacyRole: user.role ?? null,
    legacyClinicId: user.clinicId ?? null,
  };

  // Deactivated/suspended → immediate no-access context (empty authority).
  if (!isActive) {
    return {
      ...baseIdentity,
      isActive: false,
      roles: [],
      permissions: [],
      scope: { platform: false, organizationIds: [], clinicIds: [] },
      serviceAccess: [],
      defaultWorkspace: "plexus_home",
    };
  }

  // ── Active roles for the user ───────────────────────────────────────────
  const roleRows = await db
    .select({
      roleId: roles.id,
      key: roles.key,
      displayName: roles.displayName,
      scopeType: roles.scopeType,
      defaultWorkspace: roles.defaultWorkspace,
      isPrimary: userRoles.isPrimary,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.active, true)));

  const roleIds = roleRows.map((r) => r.roleId);

  // ── Permissions from those roles ─────────────────────────────────────────
  const rolePermKeys = new Set<string>();
  if (roleIds.length > 0) {
    const rp = await db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds));
    for (const row of rp) rolePermKeys.add(row.key);
  }

  // ── User permission overrides (grant/deny). Deny wins. ───────────────────
  const overrides = await db
    .select({ key: permissions.key, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
    .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.active, true)));

  const grants = new Set<string>();
  const denies = new Set<string>();
  for (const o of overrides) {
    if (o.effect === "deny") denies.add(o.key);
    else grants.add(o.key);
  }

  const effective = new Set<string>([...rolePermKeys, ...grants]);
  for (const d of denies) effective.delete(d); // deny always wins

  // ── Scope: organizations + clinics ───────────────────────────────────────
  const platform = roleRows.some((r) => r.scopeType === "platform");

  const orgRows = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)));
  const organizationIds = orgRows.map((r) => r.organizationId);

  const clinicRows = await db
    .select({ clinicId: userClinics.clinicId })
    .from(userClinics)
    .where(and(eq(userClinics.userId, userId), eq(userClinics.active, true)));
  const clinicIdSet = new Set<number>(clinicRows.map((r) => r.clinicId));
  // Fold in the LEGACY single-clinic scope so pre-backfill users still resolve.
  if (user.clinicId != null) clinicIdSet.add(user.clinicId);
  const clinicIds = [...clinicIdSet].sort((a, b) => a - b);

  // ── Service access: role defaults ⊕ user grants ⊖ user denies ────────────
  const serviceSet = new Set<string>();
  if (roleIds.length > 0) {
    const rsa = await db
      .select({ serviceCode: roleServiceAccess.serviceCode })
      .from(roleServiceAccess)
      .where(inArray(roleServiceAccess.roleId, roleIds));
    for (const s of rsa) serviceSet.add(s.serviceCode);
  }
  const usa = await db
    .select({ serviceCode: userServiceAccess.serviceCode, effect: userServiceAccess.effect })
    .from(userServiceAccess)
    .where(and(eq(userServiceAccess.userId, userId), eq(userServiceAccess.active, true)));
  for (const s of usa) {
    if (s.effect === "deny") serviceSet.delete(s.serviceCode);
    else serviceSet.add(s.serviceCode);
  }

  // ── Default workspace resolution ─────────────────────────────────────────
  // Priority: explicit user override → primary role default → any role default
  // → plexus_home.
  const primaryRole = roleRows.find((r) => r.isPrimary) ?? roleRows[0];
  const defaultWorkspace =
    (user.defaultWorkspace && user.defaultWorkspace.trim()) ||
    primaryRole?.defaultWorkspace ||
    "plexus_home";

  return {
    ...baseIdentity,
    isActive: true,
    roles: roleRows.map((r) => ({
      key: r.key,
      displayName: r.displayName,
      scopeType: r.scopeType as AccessScopeType,
      defaultWorkspace: r.defaultWorkspace,
      isPrimary: r.isPrimary,
    })),
    permissions: [...effective].sort(),
    scope: { platform, organizationIds, clinicIds },
    serviceAccess: [...serviceSet].sort(),
    defaultWorkspace,
  };
}

// ─── Capability + scope helpers (used by Phase 3 middleware later) ───────────

/** Does the context hold a given permission key? */
export function hasPermission(ctx: AccessContext | null, permissionKey: string): boolean {
  return !!ctx && ctx.isActive && ctx.permissions.includes(permissionKey);
}

/**
 * Is a target clinic within the user's scope? Platform-scoped users pass any
 * clinic. Otherwise the clinic must be in the resolved clinicIds.
 */
export function isClinicInScope(ctx: AccessContext | null, clinicId: number | null | undefined): boolean {
  if (!ctx || !ctx.isActive) return false;
  if (ctx.scope.platform) return true;
  if (clinicId == null) return false;
  return ctx.scope.clinicIds.includes(clinicId);
}

/** Is a target organization within the user's scope? Platform passes any. */
export function isOrganizationInScope(ctx: AccessContext | null, organizationId: number | null | undefined): boolean {
  if (!ctx || !ctx.isActive) return false;
  if (ctx.scope.platform) return true;
  if (organizationId == null) return false;
  return ctx.scope.organizationIds.includes(organizationId);
}

/** Does the user have access to a given ancillary service internal_code? */
export function hasServiceAccess(ctx: AccessContext | null, serviceCode: string): boolean {
  return !!ctx && ctx.isActive && ctx.serviceAccess.includes(serviceCode);
}
