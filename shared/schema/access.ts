import {
  sql, pgTable, serial, text, varchar, integer, boolean, timestamp, jsonb,
  uniqueIndex, index, createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";

// ═══════════════════════════════════════════════════════════════════════════
// Plexus OS Access Control (Phase 1 — additive foundation)
//
// ONE identity system (users + session-established identity) with a layered
// authorization model built ON TOP of the existing schema:
//
//   Organization → Clinics → Users / Teams / Services / Workflows
//
//   authorization = ROLE (permission template)
//                 ⊕ user permission GRANT overrides
//                 ⊖ user permission DENY overrides   (deny always wins)
//                 ∩ SCOPE  (platform | organization | clinic)
//                 ∩ SERVICE ACCESS (ancillary_service_registry.internal_code)
//                 → DEFAULT WORKSPACE (controlled identifier)
//
// Nothing here is destructive. `users.role` and `users.clinicId` are preserved
// as legacy mirrors; these tables are the new source of truth for access.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Scope types ────────────────────────────────────────────────────────────
// The breadth of authority a role/assignment confers. A permission check must
// evaluate BOTH capability (permission) AND scope (which org/clinic/service).
export const ACCESS_SCOPE_TYPES = ["platform", "organization", "clinic"] as const;
export type AccessScopeType = (typeof ACCESS_SCOPE_TYPES)[number];

// ─── Controlled default-workspace identifiers ───────────────────────────────
// The frontend maps these stable ids to routes. We never store arbitrary
// client-provided route strings. Extend this list as new workspaces ship.
export const WORKSPACE_IDENTIFIERS = [
  "plexus_home",
  "platform_admin",
  "organization_admin",
  "clinic_admin",
  "clinical",
  "acs",
  "pcs",
  "technician",
  "operations",
  "finance",
  "billing",
  "executive",
  "investor",
  "technical",
  "compliance",
  "patient_support",
  "implementation",
] as const;
export type WorkspaceIdentifier = (typeof WORKSPACE_IDENTIFIERS)[number];

// ─── Override effect ────────────────────────────────────────────────────────
export const PERMISSION_EFFECTS = ["grant", "deny"] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

// ─── Account status ─────────────────────────────────────────────────────────
// Richer than the legacy boolean `users.active`; the migration keeps them in
// sync (status='active' ⇔ active=true). "suspended" is treated as no-access
// like "inactive" but is a distinct admin-visible state.
export const ACCOUNT_STATUSES = ["active", "inactive", "suspended"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

// ─── organizations ──────────────────────────────────────────────────────────
// Tenant grouping ABOVE clinics. Supports single clinics, multi-clinic groups,
// MSOs, IPAs, and organization-level admins. `clinics` gains a nullable
// organization_id (see clinics.ts) that points here. A "Default Organization"
// (id=1) is seeded and backfilled to own the existing "Default Clinic".
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // single_clinic | group | mso | ipa | ... (free-form, not gated here).
  orgType: text("org_type").notNull().default("group"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_organizations_slug").on(table.slug),
  index("idx_organizations_status").on(table.status),
]);

export const insertOrganizationSchema = createInsertSchema(organizations)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().trim().min(1, "Organization name is required").max(200),
    slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric/hyphen"),
    status: z.enum(ACCOUNT_STATUSES).optional(),
  });
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

// ─── roles (permission templates) ────────────────────────────────────────────
// System roles are seeded and marked is_system=true. The model is built to
// allow custom (org-scoped) roles later WITHOUT schema change: custom roles
// simply have is_system=false and (optionally) an owning organization_id.
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  // Stable machine key, e.g. "platform_admin", "pcs". Never displayed raw.
  key: text("key").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  // The scope type this role is intended to operate at.
  scopeType: text("scope_type").notNull().default("clinic"),
  // Controlled workspace identifier this role lands in by default.
  defaultWorkspace: text("default_workspace").notNull().default("plexus_home"),
  // Seeded system role (true) vs admin-created custom role (false).
  isSystem: boolean("is_system").notNull().default(false),
  // Whether this role may be assigned to users (external/future roles can be
  // parked as non-assignable).
  isAssignable: boolean("is_assignable").notNull().default(true),
  // Optional owning organization for future custom roles (null = global).
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  // Global roles are unique by key; custom org roles get uniqueness per org via
  // a separate partial index below so a global and an org role can't collide.
  uniqueIndex("uq_roles_key_global").on(table.key).where(sql`organization_id IS NULL`),
  uniqueIndex("uq_roles_key_org").on(table.organizationId, table.key).where(sql`organization_id IS NOT NULL`),
  index("idx_roles_scope").on(table.scopeType),
]);

export const insertRoleSchema = createInsertSchema(roles)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    key: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/, "role key must be lowercase alphanumeric/underscore"),
    displayName: z.string().trim().min(1).max(120),
    scopeType: z.enum(ACCESS_SCOPE_TYPES),
    defaultWorkspace: z.enum(WORKSPACE_IDENTIFIERS),
    isSystem: z.boolean().optional(),
    isAssignable: z.boolean().optional(),
  });
export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

// ─── permissions (capability catalog) ────────────────────────────────────────
// Coherent, understandable keys (patient.read, users.manage, …). Seeded; new
// keys can be added additively as security boundaries require.
export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_permissions_key").on(table.key),
  index("idx_permissions_category").on(table.category),
]);

export const insertPermissionSchema = createInsertSchema(permissions)
  .omit({ id: true, createdAt: true })
  .extend({
    key: z.string().trim().min(1).max(80).regex(/^[a-z0-9_.]+$/, "permission key must be lowercase alphanumeric/dot/underscore"),
    category: z.string().trim().min(1).max(60),
  });
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

// ─── role_permissions (template → capabilities) ──────────────────────────────
export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_role_permissions").on(table.roleId, table.permissionId),
  index("idx_role_permissions_role").on(table.roleId),
  index("idx_role_permissions_permission").on(table.permissionId),
]);

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true });
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;

// ─── user_roles (multi-role) ──────────────────────────────────────────────────
// A user may hold multiple roles; one is marked primary (drives default
// workspace resolution unless a user-level override exists).
export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_user_roles_user").on(table.userId),
  index("idx_user_roles_role").on(table.roleId),
  // One ACTIVE row per (user, role); history rows accumulate freely.
  uniqueIndex("uq_user_roles_active").on(table.userId, table.roleId).where(sql`active`),
  // At most one ACTIVE primary role per user.
  uniqueIndex("uq_user_roles_primary").on(table.userId).where(sql`active AND is_primary`),
]);

export const insertUserRoleSchema = createInsertSchema(userRoles)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ isPrimary: z.boolean().optional(), active: z.boolean().optional() });
// NOTE: named UserRoleAssignment (not UserRole) to avoid colliding with the
// legacy string-union `UserRole` exported from users.ts through the schema barrel.
export type UserRoleAssignment = typeof userRoles.$inferSelect;
export type InsertUserRoleAssignment = z.infer<typeof insertUserRoleSchema>;

// ─── user_permission_overrides ───────────────────────────────────────────────
// Per-user grant/deny that layers on top of role templates. Deny wins.
// Optional scope narrows the override to an org/clinic/service; null = applies
// wherever the user is scoped.
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  effect: text("effect").notNull(),
  // Optional scope narrowing for the override.
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_user_perm_overrides_user").on(table.userId),
  index("idx_user_perm_overrides_permission").on(table.permissionId),
  index("idx_user_perm_overrides_active").on(table.active),
]);

export const insertUserPermissionOverrideSchema = createInsertSchema(userPermissionOverrides)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ effect: z.enum(PERMISSION_EFFECTS), active: z.boolean().optional() });
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;
export type InsertUserPermissionOverride = z.infer<typeof insertUserPermissionOverrideSchema>;

// ─── user_organizations (membership) ─────────────────────────────────────────
export const userOrganizations = pgTable("user_organizations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_user_orgs_user").on(table.userId),
  index("idx_user_orgs_org").on(table.organizationId),
  uniqueIndex("uq_user_orgs_active").on(table.userId, table.organizationId).where(sql`active`),
  uniqueIndex("uq_user_orgs_primary").on(table.userId).where(sql`active AND is_primary`),
]);

export const insertUserOrganizationSchema = createInsertSchema(userOrganizations)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ isPrimary: z.boolean().optional(), active: z.boolean().optional() });
export type UserOrganization = typeof userOrganizations.$inferSelect;
export type InsertUserOrganization = z.infer<typeof insertUserOrganizationSchema>;

// ─── user_clinics (multi-clinic assignment) ──────────────────────────────────
// Complements the legacy single users.clinicId. During transition both are
// read; users.clinicId is backfilled as one user_clinics row (primary).
export const userClinics = pgTable("user_clinics", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_user_clinics_user").on(table.userId),
  index("idx_user_clinics_clinic").on(table.clinicId),
  uniqueIndex("uq_user_clinics_active").on(table.userId, table.clinicId).where(sql`active`),
  uniqueIndex("uq_user_clinics_primary").on(table.userId).where(sql`active AND is_primary`),
]);

export const insertUserClinicSchema = createInsertSchema(userClinics)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ isPrimary: z.boolean().optional(), active: z.boolean().optional() });
export type UserClinic = typeof userClinics.$inferSelect;
export type InsertUserClinic = z.infer<typeof insertUserClinicSchema>;

// ─── service access (role defaults + user overrides) ──────────────────────────
// References ancillary_service_registry.internal_code (stable string, NOT an
// FK — mirrors the existing facility_service_settings pattern for flexibility).
// Effective service access = role defaults ⊕ user grants ⊖ user denials,
// intersected with clinic availability (facility_service_settings) at check time.
export const roleServiceAccess = pgTable("role_service_access", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  serviceCode: text("service_code").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_role_service_access").on(table.roleId, table.serviceCode),
  index("idx_role_service_access_role").on(table.roleId),
]);

export const insertRoleServiceAccessSchema = createInsertSchema(roleServiceAccess).omit({ id: true, createdAt: true });
export type RoleServiceAccess = typeof roleServiceAccess.$inferSelect;
export type InsertRoleServiceAccess = z.infer<typeof insertRoleServiceAccessSchema>;

export const userServiceAccess = pgTable("user_service_access", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceCode: text("service_code").notNull(),
  effect: text("effect").notNull().default("grant"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_user_service_access_user").on(table.userId),
  uniqueIndex("uq_user_service_access_active").on(table.userId, table.serviceCode).where(sql`active`),
]);

export const insertUserServiceAccessSchema = createInsertSchema(userServiceAccess)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ effect: z.enum(PERMISSION_EFFECTS).optional(), active: z.boolean().optional() });
export type UserServiceAccess = typeof userServiceAccess.$inferSelect;
export type InsertUserServiceAccess = z.infer<typeof insertUserServiceAccessSchema>;
