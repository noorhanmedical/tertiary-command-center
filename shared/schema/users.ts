import { sql, pgTable, varchar, text, boolean, integer, timestamp, createInsertSchema, z } from "./_common";
import { clinics } from "./clinics";

// `plexus_internal_clinical_reviewer` is the Plexus-internal clinical reviewer
// role that performs service-specific Admin Review (Phase 2C). It is a
// platform-operator-provisioned role — clinic admins do NOT get it implicitly.
// It is the ONLY role permitted by server/services/adminReview/authorization.ts.
export const USER_ROLES = ["admin", "clinician", "scheduler", "biller", "technician", "liaison", "plexus_internal_clinical_reviewer"] as const;
export type UserRole = typeof USER_ROLES[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // LEGACY role mirror. Preserved during the access-control migration so all
  // existing string checks keep working. The authoritative role/permission
  // model now lives in shared/schema/access.ts (user_roles, role_permissions,
  // user_permission_overrides). Do NOT add new authorization off this column.
  role: text("role").notNull().default("clinician"),
  active: boolean("active").notNull().default(true),
  // Multi-tenancy: which clinic this user belongs to.
  // Nullable so existing users keep working; backfill to 1 (Default Clinic).
  // Admin role bypasses clinic filtering regardless of this value.
  // LEGACY single-clinic scope; multi-clinic assignment now lives in
  // access.userClinics. Kept in sync (primary user_clinics row) during transition.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),

  // ─── Additive access-control identity fields (Phase 1) ──────────────────
  // All NULLABLE so existing rows are unaffected. Populated by backfill and by
  // the Settings user editor.
  /** Preferred real login credential going forward. Unique (case-insensitive) where present. */
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  /** Human display name; falls back to username when null. */
  displayName: text("display_name"),
  /** Free-text job/display title, SEPARATE from role (e.g. "CTO", "Ultrasound Technician"). */
  jobTitle: text("job_title"),
  /** Richer account state; kept in sync with `active`. active|inactive|suspended. */
  status: text("status").notNull().default("active"),
  /** Controlled workspace identifier this user lands in after login (overrides role default). */
  defaultWorkspace: text("default_workspace"),
  /** Whether MFA is required for this user (enforcement is a later phase). */
  mfaRequired: boolean("mfa_required").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
  /** Actor user ids for audit provenance (nullable; no FK to avoid ordering issues). */
  createdBy: varchar("created_by"),
  modifiedBy: varchar("modified_by"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
}).extend({
  role: z.enum(USER_ROLES).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
