import { sql, pgTable, serial, text, timestamp, index, createInsertSchema, z } from "./_common";

/**
 * `clinics` — tenant root table.
 *
 * Every data row in the platform belongs to exactly one clinic via a
 * `clinic_id` foreign key.  The special row with id = 1 ("Default Clinic")
 * is created by the seed migration so that all pre-existing data keeps
 * working while clinic_id is still nullable.
 *
 * The `admin` role bypasses clinic filtering and can see all clinics.
 */
export const clinics = pgTable("clinics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_clinics_slug").on(table.slug),
]);

export const insertClinicSchema = createInsertSchema(clinics).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().trim().min(1, "Clinic name is required").max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export type Clinic = typeof clinics.$inferSelect;
export type InsertClinic = z.infer<typeof insertClinicSchema>;
