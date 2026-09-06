// ═══════════════════════════════════════════════════════════════════════════
// Access-management SERVICE (Phase 4A) — the backend foundation for Settings.
//
// One cohesive domain for administering users, roles, org/clinic membership,
// permission + service overrides, and default workspace, built entirely on the
// NEW access-control model. Every mutation:
//   • validates inputs against the catalogs (no arbitrary strings),
//   • enforces the actor's authority via roleAuthority (no privilege escalation),
//   • writes an audit event (actor + target + before/after),
//   • keeps the legacy users.role mirror synchronized for the primary role.
//
// Effective permissions/services are NEVER written to the DB — they are always
// computed by resolveAccessContext.
// ═══════════════════════════════════════════════════════════════════════════

import { and, eq, inArray, sql, desc, asc } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema/users";
import { clinics } from "@shared/schema/clinics";
import { auditLog } from "@shared/schema/audit";
import { ancillaryServiceRegistry } from "@shared/schema/ancillaryServiceRegistry";
import {
  organizations, roles, permissions, rolePermissions, userRoles,
  userPermissionOverrides, userOrganizations, userClinics,
  roleServiceAccess, userServiceAccess,
} from "@shared/schema/access";
import {
  resolveAccessContext, type AccessContext,
} from "./accessContextService";
import {
  canAssignRole, canGrantPermission, canAssignOrganization, canAssignClinic,
  canAssignService, canAdministerTarget, isValidRoleKey, isValidPermissionKey,
  isValidWorkspaceId, isAssignableRole, type AuthorityResult,
} from "./roleAuthority";
import { legacyRoleMirrorFor } from "@shared/accessControl/catalog";

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function forbid(reason: string): never { throw new AccessError(403, reason); }
function badRequest(reason: string): never { throw new AccessError(400, reason); }
function notFound(reason = "not_found"): never { throw new AccessError(404, reason); }
function must(r: AuthorityResult): void { if (!r.ok) forbid(r.reason); }

// ─── Audit ───────────────────────────────────────────────────────────────────
// Access-management events embed the TARGET's persisted scope (organizationIds
// + clinicIds) in `changes._scope` so an organization-scoped audit viewer can
// see events affecting users in their organization even when the audit row has
// no single clinic_id (multi-clinic users are represented fully, never reduced
// to one arbitrary clinic).
interface AuditScope { organizationIds: number[]; clinicIds: number[]; }

async function audit(
  actor: AccessContext,
  action: string,
  entityType: string,
  entityId: string | number | null,
  changes: Record<string, unknown>,
  opts: { scope?: AuditScope; clinicId?: number | null } = {},
): Promise<void> {
  try {
    const merged = opts.scope ? { ...changes, _scope: opts.scope } : changes;
    await db.insert(auditLog).values({
      clinicId: opts.clinicId ?? null,
      userId: actor.id,
      username: actor.username,
      action,
      entityType,
      entityId: entityId != null ? String(entityId) : null,
      changes: merged,
    });
  } catch (e) {
    console.error("[accessAdmin] audit write failed:", e instanceof Error ? e.message : e);
  }
}

/** Resolve a user's persisted scope (org memberships + their clinics' orgs, and
 *  all clinics incl. the legacy single clinic). Used to tag access audit rows. */
async function resolveTargetScope(userId: string): Promise<AuditScope> {
  const [u] = await db.select({ clinicId: users.clinicId }).from(users).where(eq(users.id, userId));
  const orgRows = await db.select({ o: userOrganizations.organizationId }).from(userOrganizations)
    .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)));
  const clinicSet = new Set<number>((await db.select({ c: userClinics.clinicId }).from(userClinics)
    .where(and(eq(userClinics.userId, userId), eq(userClinics.active, true)))).map((r) => r.c));
  if (u?.clinicId != null) clinicSet.add(u.clinicId);
  const clinicIds = [...clinicSet];
  const orgSet = new Set<number>(orgRows.map((r) => r.o));
  if (clinicIds.length) {
    const rows = await db.select({ o: clinics.organizationId }).from(clinics).where(inArray(clinics.id, clinicIds));
    for (const r of rows) if (r.o != null) orgSet.add(r.o);
  }
  return { organizationIds: [...orgSet], clinicIds };
}

/** Audit a user-targeted access mutation with scope tagging. */
async function auditUser(actor: AccessContext, action: string, userId: string, changes: Record<string, unknown>): Promise<void> {
  const scope = await resolveTargetScope(userId);
  // Set clinic_id only when unambiguous (single clinic); otherwise rely on _scope.
  await audit(actor, action, "user_access", userId, changes, {
    scope,
    clinicId: scope.clinicIds.length === 1 ? scope.clinicIds[0] : null,
  });
}

// ─── Clinic → organization resolution (persisted ownership) ───────────────────
export async function clinicOrganizationId(clinicId: number): Promise<number | null> {
  const [row] = await db.select({ orgId: clinics.organizationId }).from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  return row?.orgId ?? null;
}

/** Clinic ids the actor may administer (platform → all clinics). */
export async function actorAdministrableClinicIds(actor: AccessContext): Promise<number[] | "all"> {
  if (actor.scope.platform) return "all";
  const set = new Set<number>(actor.scope.clinicIds);
  // Org admins administer every clinic in their organization(s).
  if (actor.scope.organizationIds.length > 0) {
    const rows = await db.select({ id: clinics.id }).from(clinics)
      .where(inArray(clinics.organizationId, actor.scope.organizationIds));
    for (const r of rows) set.add(r.id);
  }
  return [...set];
}

// ─── USER LIST ────────────────────────────────────────────────────────────────
export interface UserListFilters {
  search?: string; status?: string; organizationId?: number; clinicId?: number; role?: string;
}
export async function listUsers(actor: AccessContext, f: UserListFilters = {}) {
  const rows = await db.select({
    id: users.id, username: users.username, email: users.email,
    firstName: users.firstName, lastName: users.lastName, displayName: users.displayName,
    jobTitle: users.jobTitle, status: users.status, active: users.active,
    role: users.role, clinicId: users.clinicId, defaultWorkspace: users.defaultWorkspace,
    lastLoginAt: users.lastLoginAt,
  }).from(users).orderBy(asc(users.username));

  // Scope: non-platform actors see only users sharing an org/clinic with them.
  const administrable = await actorAdministrableClinicIds(actor);
  const orgIds = new Set(actor.scope.organizationIds);
  const visible = [] as typeof rows;
  for (const u of rows) {
    if (administrable === "all") { visible.push(u); continue; }
    // Resolve the user's org/clinic membership cheaply from their own context
    // would be N queries; instead use legacy clinicId + user_clinics/orgs.
    visible.push(u); // placeholder; refined below via membership sets
  }
  // Refine visibility using membership tables in ONE pass (avoid N+1 in prod:
  // fine for Settings-scale lists).
  let scoped = visible;
  if (administrable !== "all") {
    const allowedClinics = new Set(administrable);
    const uc = await db.select({ userId: userClinics.userId, clinicId: userClinics.clinicId })
      .from(userClinics).where(eq(userClinics.active, true));
    const uo = await db.select({ userId: userOrganizations.userId, organizationId: userOrganizations.organizationId })
      .from(userOrganizations).where(eq(userOrganizations.active, true));
    const clinicByUser = new Map<string, number[]>();
    for (const r of uc) { const a = clinicByUser.get(r.userId) ?? []; a.push(r.clinicId); clinicByUser.set(r.userId, a); }
    const orgByUser = new Map<string, number[]>();
    for (const r of uo) { const a = orgByUser.get(r.userId) ?? []; a.push(r.organizationId); orgByUser.set(r.userId, a); }
    scoped = rows.filter((u) => {
      if (u.clinicId != null && allowedClinics.has(u.clinicId)) return true;
      if ((clinicByUser.get(u.id) ?? []).some((c) => allowedClinics.has(c))) return true;
      if ((orgByUser.get(u.id) ?? []).some((o) => orgIds.has(o))) return true;
      return false;
    });
  }

  const term = f.search?.trim().toLowerCase();
  return scoped.filter((u) => {
    if (f.status && u.status !== f.status) return false;
    if (f.role && u.role !== f.role) return false;
    if (f.clinicId != null && u.clinicId !== f.clinicId) return false;
    if (term) {
      const hay = `${u.username} ${u.email ?? ""} ${u.displayName ?? ""} ${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }).map((u) => ({
    id: u.id, username: u.username, email: u.email,
    firstName: u.firstName, lastName: u.lastName, displayName: u.displayName ?? u.username,
    jobTitle: u.jobTitle, status: u.status, active: u.active,
    primaryLegacyRole: u.role, defaultWorkspace: u.defaultWorkspace, lastLoginAt: u.lastLoginAt,
  }));
}

// ─── USER DETAIL (full access profile) ─────────────────────────────────────────
export async function getUserAccessProfile(actor: AccessContext, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) notFound("user_not_found");
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));

  const roleRows = await db.select({ key: roles.key, displayName: roles.displayName, isPrimary: userRoles.isPrimary })
    .from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.active, true)));
  const primary = roleRows.find((r) => r.isPrimary) ?? null;
  const additional = roleRows.filter((r) => !r.isPrimary);

  // inherited permissions from the user's roles
  const roleIds = (await db.select({ id: roles.id }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.active, true)))).map((r) => r.id);
  const inheritedPerms = roleIds.length
    ? (await db.select({ key: permissions.key }).from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(inArray(rolePermissions.roleId, roleIds))).map((r) => r.key)
    : [];
  const overrides = await db.select({ key: permissions.key, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides).innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
    .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.active, true)));

  const inheritedSvc = roleIds.length
    ? (await db.select({ code: roleServiceAccess.serviceCode }).from(roleServiceAccess).where(inArray(roleServiceAccess.roleId, roleIds))).map((r) => r.code)
    : [];
  const svcOverrides = await db.select({ code: userServiceAccess.serviceCode, effect: userServiceAccess.effect })
    .from(userServiceAccess).where(and(eq(userServiceAccess.userId, userId), eq(userServiceAccess.active, true)));

  const orgs = await db.select({ organizationId: userOrganizations.organizationId, isPrimary: userOrganizations.isPrimary })
    .from(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)));
  const cls = await db.select({ clinicId: userClinics.clinicId, isPrimary: userClinics.isPrimary })
    .from(userClinics).where(and(eq(userClinics.userId, userId), eq(userClinics.active, true)));

  return {
    identity: { id: u.id, firstName: u.firstName, lastName: u.lastName, displayName: u.displayName, email: u.email, username: u.username, jobTitle: u.jobTitle },
    account: { status: u.status, active: u.active, mfaRequired: u.mfaRequired, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, updatedAt: u.updatedAt },
    roles: { primary: primary?.key ?? null, additional: additional.map((r) => r.key) },
    organizations: orgs,
    clinics: cls,
    permissions: {
      inherited: [...new Set(inheritedPerms)].sort(),
      grants: overrides.filter((o) => o.effect === "grant").map((o) => o.key).sort(),
      denies: overrides.filter((o) => o.effect === "deny").map((o) => o.key).sort(),
      effective: target.permissions,
    },
    serviceAccess: {
      inherited: [...new Set(inheritedSvc)].sort(),
      grants: svcOverrides.filter((o) => o.effect === "grant").map((o) => o.code).sort(),
      denies: svcOverrides.filter((o) => o.effect === "deny").map((o) => o.code).sort(),
      effective: target.serviceAccess,
    },
    defaultWorkspace: target.defaultWorkspace,
    accessSummary: { platformScope: target.scope.platform, organizationIds: target.scope.organizationIds, clinicIds: target.scope.clinicIds },
  };
}

// ─── ROLE ASSIGNMENT ───────────────────────────────────────────────────────────
export async function setUserRoles(actor: AccessContext, userId: string, input: { primary: string; additional?: string[] }) {
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));

  const primary = input.primary;
  const additional = [...new Set(input.additional ?? [])].filter((k) => k !== primary);
  const all = [primary, ...additional];
  for (const key of all) {
    if (!isValidRoleKey(key)) badRequest(`unknown_role:${key}`);
    if (!isAssignableRole(key)) badRequest(`role_not_assignable:${key}`);
    must(canAssignRole(actor, key));
  }
  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(and(inArray(roles.key, all), sql`organization_id IS NULL`));
  const idByKey = new Map(roleRows.map((r) => [r.key, r.id]));
  for (const key of all) if (!idByKey.has(key)) badRequest(`role_not_seeded:${key}`);

  const before = (await db.select({ key: roles.key, isPrimary: userRoles.isPrimary })
    .from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.active, true))));

  await db.transaction(async (tx) => {
    await tx.update(userRoles).set({ active: false, updatedAt: new Date() }).where(and(eq(userRoles.userId, userId), eq(userRoles.active, true)));
    for (const key of all) {
      await tx.insert(userRoles).values({ userId, roleId: idByKey.get(key)!, isPrimary: key === primary, active: true });
    }
    // Legacy mirror sync for the primary role.
    const mirror = legacyRoleMirrorFor(primary);
    await tx.update(users).set({ role: mirror.legacy, updatedAt: new Date() }).where(eq(users.id, userId));
  });

  const mirror = legacyRoleMirrorFor(primary);
  await auditUser(actor, "user.role.assigned", userId, {
    before: before.map((b) => ({ key: b.key, primary: b.isPrimary })),
    after: { primary, additional },
    legacyMirror: mirror.legacy, legacyMirrorMapped: mirror.mapped,
  });
  return { primary, additional, legacyMirror: mirror };
}

// ─── PERMISSION OVERRIDES ───────────────────────────────────────────────────────
export async function setUserPermissionOverrides(actor: AccessContext, userId: string, input: { grants?: string[]; denies?: string[] }) {
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));

  const denies = [...new Set(input.denies ?? [])];
  // Deny wins: a key present in both grants and denies is treated as a deny.
  const grants = [...new Set(input.grants ?? [])].filter((k) => !denies.includes(k));
  for (const k of [...grants, ...denies]) if (!isValidPermissionKey(k)) badRequest(`unknown_permission:${k}`);
  // Escalation: the actor may only GRANT permissions they themselves hold.
  for (const k of grants) must(canGrantPermission(actor, k));

  const permRows = await db.select({ id: permissions.id, key: permissions.key }).from(permissions).where(inArray(permissions.key, [...grants, ...denies, "__none__"]));
  const idByKey = new Map(permRows.map((p) => [p.key, p.id]));

  const before = await db.select({ key: permissions.key, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides).innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
    .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.active, true)));

  await db.transaction(async (tx) => {
    await tx.update(userPermissionOverrides).set({ active: false, updatedAt: new Date() }).where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.active, true)));
    for (const k of grants) await tx.insert(userPermissionOverrides).values({ userId, permissionId: idByKey.get(k)!, effect: "grant", active: true });
    for (const k of denies) await tx.insert(userPermissionOverrides).values({ userId, permissionId: idByKey.get(k)!, effect: "deny", active: true });
  });
  await auditUser(actor, "user.permission.override_set", userId, { before, after: { grants, denies } });
  const refreshed = await resolveAccessContext(userId);
  return { grants, denies, effective: refreshed?.permissions ?? [] };
}

// ─── SERVICE ACCESS ─────────────────────────────────────────────────────────────
export async function setUserServiceAccess(actor: AccessContext, userId: string, input: { grants?: string[]; denies?: string[] }) {
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));

  const denies = [...new Set(input.denies ?? [])];
  // Deny wins: a code present in both grants and denies is treated as a deny.
  const grants = [...new Set(input.grants ?? [])].filter((c) => !denies.includes(c));
  const known = new Set((await db.select({ code: ancillaryServiceRegistry.internalCode }).from(ancillaryServiceRegistry)).map((r) => r.code));
  for (const c of [...grants, ...denies]) if (!known.has(c)) badRequest(`unknown_service:${c}`);
  for (const c of grants) must(canAssignService(actor, c));

  const before = await db.select({ code: userServiceAccess.serviceCode, effect: userServiceAccess.effect })
    .from(userServiceAccess).where(and(eq(userServiceAccess.userId, userId), eq(userServiceAccess.active, true)));
  await db.transaction(async (tx) => {
    await tx.update(userServiceAccess).set({ active: false, updatedAt: new Date() }).where(and(eq(userServiceAccess.userId, userId), eq(userServiceAccess.active, true)));
    for (const c of grants) await tx.insert(userServiceAccess).values({ userId, serviceCode: c, effect: "grant", active: true });
    for (const c of denies) await tx.insert(userServiceAccess).values({ userId, serviceCode: c, effect: "deny", active: true });
  });
  await auditUser(actor, "user.service_access.set", userId, { before, after: { grants, denies } });
  const refreshed = await resolveAccessContext(userId);
  return { grants, denies, effective: refreshed?.serviceAccess ?? [] };
}

// ─── ORGANIZATIONS ASSIGNMENT ───────────────────────────────────────────────────
export async function setUserOrganizations(actor: AccessContext, userId: string, input: { organizationId: number; isPrimary?: boolean }[]) {
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));
  const orgIds = input.map((o) => o.organizationId);
  if (orgIds.length) {
    const exist = new Set((await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.id, orgIds))).map((r) => r.id));
    for (const o of input) { if (!exist.has(o.organizationId)) badRequest(`unknown_organization:${o.organizationId}`); must(canAssignOrganization(actor, o.organizationId)); }
  }
  const before = await db.select({ organizationId: userOrganizations.organizationId, isPrimary: userOrganizations.isPrimary })
    .from(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)));
  await db.transaction(async (tx) => {
    await tx.update(userOrganizations).set({ active: false, updatedAt: new Date() }).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)));
    let primarySet = false;
    for (const o of input) {
      const isPrimary = !!o.isPrimary && !primarySet; if (isPrimary) primarySet = true;
      await tx.insert(userOrganizations).values({ userId, organizationId: o.organizationId, isPrimary, active: true });
    }
  });
  await auditUser(actor, "user.organization.assigned", userId, { before, after: input });
  return { organizations: input };
}

// ─── CLINICS ASSIGNMENT ─────────────────────────────────────────────────────────
export async function setUserClinics(actor: AccessContext, userId: string, input: { clinicId: number; isPrimary?: boolean }[]) {
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));
  const clinicIds = input.map((c) => c.clinicId);
  const administrable = await actorAdministrableClinicIds(actor);
  if (clinicIds.length) {
    const exist = new Set((await db.select({ id: clinics.id }).from(clinics).where(inArray(clinics.id, clinicIds))).map((r) => r.id));
    for (const c of input) {
      if (!exist.has(c.clinicId)) badRequest(`unknown_clinic:${c.clinicId}`);
      if (administrable !== "all" && !administrable.includes(c.clinicId)) must(canAssignClinic(actor, c.clinicId));
    }
  }
  const before = await db.select({ clinicId: userClinics.clinicId, isPrimary: userClinics.isPrimary })
    .from(userClinics).where(and(eq(userClinics.userId, userId), eq(userClinics.active, true)));
  await db.transaction(async (tx) => {
    await tx.update(userClinics).set({ active: false, updatedAt: new Date() }).where(and(eq(userClinics.userId, userId), eq(userClinics.active, true)));
    let primarySet = false;
    for (const c of input) {
      const isPrimary = !!c.isPrimary && !primarySet; if (isPrimary) primarySet = true;
      await tx.insert(userClinics).values({ userId, clinicId: c.clinicId, isPrimary, active: true });
    }
  });
  await auditUser(actor, "user.clinic.assigned", userId, { before, after: input });
  return { clinics: input };
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
const STATUSES = new Set(["active", "inactive", "suspended"]);
export async function setUserStatus(actor: AccessContext, userId: string, status: string) {
  if (!STATUSES.has(status)) badRequest(`invalid_status:${status}`);
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));
  if (userId === actor.id && status !== "active") badRequest("cannot_change_own_status");
  const before = { status: target.accountStatus, active: target.isActive };
  await db.update(users).set({ status, active: status === "active", updatedAt: new Date() }).where(eq(users.id, userId));
  await auditUser(actor, "user.status.changed", userId, { before, after: { status, active: status === "active" } });
  return { status, active: status === "active" };
}

// ─── DEFAULT WORKSPACE ──────────────────────────────────────────────────────────
export async function setUserDefaultWorkspace(actor: AccessContext, userId: string, workspace: string) {
  if (!isValidWorkspaceId(workspace)) badRequest(`invalid_workspace:${workspace}`);
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));
  const before = target.defaultWorkspace;
  await db.update(users).set({ defaultWorkspace: workspace, updatedAt: new Date() }).where(eq(users.id, userId));
  await auditUser(actor, "user.default_workspace.changed", userId, { before, after: workspace });
  return { defaultWorkspace: workspace };
}

// ─── IDENTITY UPDATE ────────────────────────────────────────────────────────────
export async function updateUserIdentity(actor: AccessContext, userId: string, input: { firstName?: string; lastName?: string; displayName?: string; email?: string; jobTitle?: string }) {
  const target = await resolveAccessContext(userId);
  if (!target) notFound("user_not_found");
  must(canAdministerTarget(actor, target));
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["firstName", "lastName", "displayName", "email", "jobTitle"] as const) if (input[k] !== undefined) patch[k] = input[k];
  await db.update(users).set(patch).where(eq(users.id, userId));
  await auditUser(actor, "user.identity.updated", userId, { after: input });
  return { ok: true };
}

// ─── READS: organizations / clinics / roles / permissions / services ─────────────
export async function listOrganizations(actor: AccessContext) {
  const rows = await db.select().from(organizations).orderBy(asc(organizations.name));
  const visible = actor.scope.platform ? rows : rows.filter((o) => actor.scope.organizationIds.includes(o.id));
  return visible;
}
export async function getOrganization(actor: AccessContext, id: number) {
  if (!actor.scope.platform && !actor.scope.organizationIds.includes(id)) forbid("organization_out_of_scope");
  const [o] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!o) notFound("organization_not_found");
  const clinicList = await db.select({ id: clinics.id, name: clinics.name }).from(clinics).where(eq(clinics.organizationId, id));
  return { ...o, clinics: clinicList };
}
export async function createOrganization(actor: AccessContext, input: { name: string; slug: string; orgType?: string }) {
  if (!actor.scope.platform) forbid("requires_platform_scope");
  const [created] = await db.insert(organizations).values({ name: input.name, slug: input.slug, orgType: input.orgType ?? "group", status: "active" }).returning();
  await audit(actor, "organization.created", "organization", created.id, { after: { name: created.name, slug: created.slug } });
  return created;
}
export async function updateOrganization(actor: AccessContext, id: number, input: { name?: string; status?: string }) {
  if (!actor.scope.platform && !actor.scope.organizationIds.includes(id)) forbid("organization_out_of_scope");
  const [before] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!before) notFound("organization_not_found");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.status !== undefined) patch.status = input.status;
  const [updated] = await db.update(organizations).set(patch).where(eq(organizations.id, id)).returning();
  await audit(actor, "organization.updated", "organization", id, { before: { name: before.name, status: before.status }, after: input });
  return updated;
}

export async function listClinics(actor: AccessContext) {
  const rows = await db.select().from(clinics).orderBy(asc(clinics.name));
  const administrable = await actorAdministrableClinicIds(actor);
  return administrable === "all" ? rows : rows.filter((c) => administrable.includes(c.id));
}
export async function getClinic(actor: AccessContext, id: number) {
  const administrable = await actorAdministrableClinicIds(actor);
  if (administrable !== "all" && !administrable.includes(id)) forbid("clinic_out_of_scope");
  const [c] = await db.select().from(clinics).where(eq(clinics.id, id));
  if (!c) notFound("clinic_not_found");
  return c;
}
export async function updateClinic(actor: AccessContext, id: number, input: { name?: string; active?: boolean; shortName?: string }) {
  const administrable = await actorAdministrableClinicIds(actor);
  if (administrable !== "all" && !administrable.includes(id)) forbid("clinic_out_of_scope");
  const [before] = await db.select().from(clinics).where(eq(clinics.id, id));
  if (!before) notFound("clinic_not_found");
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "active", "shortName"] as const) if (input[k] !== undefined) patch[k] = input[k];
  const [updated] = await db.update(clinics).set(patch).where(eq(clinics.id, id)).returning();
  await audit(actor, "clinic.access.updated", "clinic", id, { before: { name: before.name, active: before.active }, after: input }, { clinicId: id });
  return updated;
}

export async function listRoles() {
  return db.select().from(roles).where(sql`organization_id IS NULL`).orderBy(asc(roles.key));
}
export async function getRole(key: string) {
  const [r] = await db.select().from(roles).where(and(eq(roles.key, key), sql`organization_id IS NULL`));
  if (!r) notFound("role_not_found");
  const perms = (await db.select({ key: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id)).where(eq(rolePermissions.roleId, r.id))).map((p) => p.key);
  const svcs = (await db.select({ code: roleServiceAccess.serviceCode }).from(roleServiceAccess).where(eq(roleServiceAccess.roleId, r.id))).map((s) => s.code);
  return { ...r, defaultPermissions: perms.sort(), defaultServiceAccess: svcs.sort() };
}
export async function listPermissions() {
  return db.select().from(permissions).orderBy(asc(permissions.category), asc(permissions.key));
}
export async function listServices() {
  return db.select({
    internalCode: ancillaryServiceRegistry.internalCode,
    displayName: ancillaryServiceRegistry.displayName,
    active: ancillaryServiceRegistry.active,
    category: ancillaryServiceRegistry.category,
  }).from(ancillaryServiceRegistry).orderBy(asc(ancillaryServiceRegistry.displayName));
}

// ─── ORG-SCOPED AUDIT ─────────────────────────────────────────────────────────
// Platform actors (platform.audit.view) see everything. Org actors
// (audit.organization.view) see ONLY events whose clinic_id belongs to their
// administrable clinics. Rows with a NULL clinic_id are platform-level and are
// NOT returned to org-scoped viewers (reported limitation).
export async function queryAudit(actor: AccessContext, opts: { platform: boolean; limit?: number; entityType?: string }) {
  const limit = Math.min(opts.limit ?? 200, 500);
  if (opts.platform) {
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
    return { scope: "platform", rows };
  }
  const administrable = await actorAdministrableClinicIds(actor);
  if (administrable === "all") {
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
    return { scope: "platform", rows };
  }
  const allowedClinics = new Set(administrable);
  const actorOrgs = new Set(actor.scope.organizationIds);
  // Bounded fetch, then filter by direct clinic_id OR the target-scope metadata
  // embedded in changes._scope (covers multi-clinic users with clinic_id NULL).
  const recent = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(Math.min(limit * 10, 2000));
  const rows = recent.filter((r) => {
    if (r.clinicId != null && allowedClinics.has(r.clinicId)) return true;
    const scope = (r.changes as { _scope?: AuditScope } | null)?._scope;
    if (scope) {
      if (scope.clinicIds?.some((c) => allowedClinics.has(c))) return true;
      if (scope.organizationIds?.some((o) => actorOrgs.has(o))) return true;
    }
    return false;
  }).slice(0, limit);
  return { scope: "organization", rows };
}
