// ═══════════════════════════════════════════════════════════════════════════
// Access-management AUTHORITY rules (Phase 4A) — pure, DB-free, unit-testable.
//
// These enforce that an administrator can never escalate privilege through the
// access-management APIs. The golden rule:
//
//   You cannot grant capability, scope, a role, or service access that YOU
//   yourself do not already hold — unless you are platform-scoped and hold the
//   relevant capability, in which case you act at platform breadth.
//
// Route middleware still gates WHO may call these APIs at all (users.manage).
// These functions cap WHAT that caller may assign, relative to their own
// resolved access context. The frontend is never the authority.
// ═══════════════════════════════════════════════════════════════════════════

import type { AccessContext } from "./accessContextService";
import { ROLE_CATALOG, PERMISSION_CATALOG, ALL_PERMISSION_KEYS } from "@shared/accessControl/catalog";
import { WORKSPACE_IDENTIFIERS } from "@shared/schema/access";

const ROLE_BY_KEY = new Map(ROLE_CATALOG.map((r) => [r.key, r]));
const PERMISSION_KEYS = new Set(ALL_PERMISSION_KEYS);
const WORKSPACE_SET = new Set<string>(WORKSPACE_IDENTIFIERS as readonly string[]);

export type AuthorityResult = { ok: true } | { ok: false; reason: string };

const ok: AuthorityResult = { ok: true };
const no = (reason: string): AuthorityResult => ({ ok: false, reason });

/**
 * The intentional platform-level user-access authority: a platform-scoped
 * holder of `users.manage` administers access ACROSS the platform and may
 * assign any assignable role / grant any permission "as designed" — WITHOUT
 * personally holding every clinical/PHI capability. (A platform admin
 * configures who may read PHI without themselves reading PHI.) Lower-scope
 * admins get NO such exemption and remain capped to their own capability.
 */
export function hasPlatformUserAuthority(actor: AccessContext): boolean {
  return actor.scope.platform && actor.permissions.includes("users.manage");
}

// ─── Catalog validity (reject arbitrary client strings) ─────────────────────

export function isValidRoleKey(key: string): boolean {
  return ROLE_BY_KEY.has(key);
}
export function isValidPermissionKey(key: string): boolean {
  return PERMISSION_KEYS.has(key);
}
export function isValidWorkspaceId(id: string): boolean {
  return WORKSPACE_SET.has(id);
}
export function isAssignableRole(key: string): boolean {
  const r = ROLE_BY_KEY.get(key);
  return !!r && r.isAssignable !== false;
}

/** The default permission bundle a role confers (from the catalog). */
export function roleDefaultPermissions(key: string): readonly string[] {
  return ROLE_BY_KEY.get(key)?.permissions ?? [];
}

// ─── Capability escalation ───────────────────────────────────────────────────

/**
 * An actor may grant a permission only if they themselves currently hold it.
 * (Deny/remove are always allowed — they cannot escalate the target.)
 */
export function canGrantPermission(actor: AccessContext, permissionKey: string): AuthorityResult {
  if (!isValidPermissionKey(permissionKey)) return no(`unknown_permission:${permissionKey}`);
  if (hasPlatformUserAuthority(actor)) return ok; // platform user-access authority
  if (!actor.permissions.includes(permissionKey)) return no(`actor_lacks_permission:${permissionKey}`);
  return ok;
}

/**
 * An actor may assign a ROLE only if:
 *   • the role exists and is assignable, AND
 *   • the actor holds EVERY permission in the role's default bundle (can't
 *     confer capabilities the actor lacks), AND
 *   • a platform-scoped role (platform_admin/technical_admin/…): only a
 *     platform-scoped actor may assign it (prevents an org/clinic admin from
 *     minting platform operators).
 */
export function canAssignRole(actor: AccessContext, roleKey: string): AuthorityResult {
  const role = ROLE_BY_KEY.get(roleKey);
  if (!role) return no(`unknown_role:${roleKey}`);
  if (role.isAssignable === false) return no(`role_not_assignable:${roleKey}`);
  // Platform user-access authority may assign ANY assignable role (incl.
  // platform + clinical roles) — administrative delegation, not self-use.
  if (hasPlatformUserAuthority(actor)) return ok;
  // Lower-scope admins: never mint platform-scoped roles…
  if (role.scopeType === "platform") {
    return no(`requires_platform_authority_to_assign:${roleKey}`);
  }
  // …and never confer a capability they do not themselves hold.
  for (const p of role.permissions) {
    if (!actor.permissions.includes(p)) return no(`actor_lacks_role_permission:${p}`);
  }
  return ok;
}

// ─── Scope escalation ────────────────────────────────────────────────────────

/** Assigning an organization requires the actor to be in that org (or platform). */
export function canAssignOrganization(actor: AccessContext, organizationId: number): AuthorityResult {
  if (actor.scope.platform) return ok;
  if (actor.scope.organizationIds.includes(organizationId)) return ok;
  return no(`organization_out_of_actor_scope:${organizationId}`);
}

/** Assigning a clinic requires the actor to administer that clinic (or platform). */
export function canAssignClinic(actor: AccessContext, clinicId: number): AuthorityResult {
  if (actor.scope.platform) return ok;
  if (actor.scope.clinicIds.includes(clinicId)) return ok;
  return no(`clinic_out_of_actor_scope:${clinicId}`);
}

/**
 * Service access is SEPARATE from capability. An actor may grant a service
 * only if they hold that service (or are platform-scoped). Unknown services
 * are rejected by the caller against the live registry.
 */
export function canAssignService(actor: AccessContext, serviceCode: string): AuthorityResult {
  if (actor.scope.platform) return ok;
  if (actor.serviceAccess.includes(serviceCode)) return ok;
  return no(`service_out_of_actor_scope:${serviceCode}`);
}

/**
 * Whether the actor may administer the given target user at all, based on
 * SCOPE overlap: platform actors may manage anyone; otherwise the actor and
 * target must share at least one organization or clinic. (Capability to call
 * the API — users.manage — is enforced by route middleware.)
 */
export function canAdministerTarget(actor: AccessContext, target: AccessContext): AuthorityResult {
  if (actor.scope.platform) return ok;
  const orgOverlap = target.scope.organizationIds.some((o) => actor.scope.organizationIds.includes(o));
  const clinicOverlap = target.scope.clinicIds.some((c) => actor.scope.clinicIds.includes(c));
  if (orgOverlap || clinicOverlap) return ok;
  return no("target_outside_actor_scope");
}
