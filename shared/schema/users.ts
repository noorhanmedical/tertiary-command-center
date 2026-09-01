import { sql, pgTable, varchar, text, boolean, integer, createInsertSchema, z } from "./_common";
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
  role: text("role").notNull().default("clinician"),
  active: boolean("active").notNull().default(true),
  // Multi-tenancy: which clinic this user belongs to.
  // Nullable so existing users keep working; backfill to 1 (Default Clinic).
  // Admin role bypasses clinic filtering regardless of this value.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
}).extend({
  role: z.enum(USER_ROLES).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
