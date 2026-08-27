import { sql, pgTable, serial, text, integer, timestamp, boolean, index, uniqueIndex, createInsertSchema, z } from "./_common";

/**
 * `clinics` — tenant root table AND the canonical FACILITY directory.
 *
 * Every data row in the platform belongs to exactly one clinic via a
 * `clinic_id` foreign key.  The special row with id = 1 ("Default Clinic")
 * is created by the seed migration so that all pre-existing data keeps
 * working while clinic_id is still nullable.
 *
 * The `admin` role bypasses clinic filtering and can see all clinics.
 *
 * NOTE: `timezone`/`address`/`phone`/`active` already exist in the live
 * database (added by an earlier migration) and are declared here so the
 * ORM can read/write them. `shortName`/`facilityType`/`code` are the
 * additive Plexus IQ facility-management fields — all nullable, so legacy
 * clinic rows are unaffected.
 */
export const clinics = pgTable("clinics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // Pre-existing live columns (declared so the ORM is aware of them).
  timezone: text("timezone").default("America/Chicago"),
  address: text("address"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  // Additive facility-management fields (Plexus IQ Settings).
  shortName: text("short_name"),
  facilityType: text("facility_type"),
  /** Optional internal identifier / code. */
  code: text("code"),
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

// ─── clinicians ────────────────────────────────────────────────────────
// Canonical clinician DIRECTORY — the source for Plexus IQ batch clinician
// selection. This is DISTINCT from `patient_clinical_providers` (which is a
// per-patient care-team snapshot, keyed by patient_screening_id) and from
// `outreach_schedulers` (the call-staff roster). A clinician here is "the
// ordering/list-owner clinician whose patient list a batch is run against."
export const clinicians = pgTable("clinicians", {
  id: serial("id").primaryKey(),
  /** Display name, e.g. "Dr Taylor" or "John Taylor, MD". */
  displayName: text("display_name").notNull(),
  /** Credentials / suffix, e.g. "MD", "DO", "NP". Optional. */
  credentials: text("credentials"),
  /** NPI if available. Optional; not validated as canonical identity here. */
  npi: text("npi"),
  /** Free-form role/type, e.g. "physician", "np", "pa". Optional. */
  role: text("role"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_clinicians_display_name").on(table.displayName),
  index("idx_clinicians_active").on(table.active),
]);

export const insertClinicianSchema = createInsertSchema(clinicians).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  displayName: z.string().trim().min(1, "Clinician name is required").max(200),
  credentials: z.string().trim().max(50).optional().nullable(),
  npi: z.string().trim().max(20).optional().nullable(),
  role: z.string().trim().max(50).optional().nullable(),
  active: z.boolean().optional(),
});

export type Clinician = typeof clinicians.$inferSelect;
export type InsertClinician = z.infer<typeof insertClinicianSchema>;

// ─── facility_clinicians ─────────────────────────────────────────────────
// Many-to-many relationship between clinics (facilities) and clinicians. A
// clinician may be associated with one or many facilities. The relationship
// row carries its own `active` flag so a clinician can be inactivated at one
// facility without being removed globally.
export const facilityClinicians = pgTable("facility_clinicians", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  clinicianId: integer("clinician_id").notNull().references(() => clinicians.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  /** Optional ordering hint for the batch dropdown. */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_facility_clinician").on(table.clinicId, table.clinicianId),
  index("idx_facility_clinicians_clinic").on(table.clinicId),
  index("idx_facility_clinicians_clinician").on(table.clinicianId),
]);

export const insertFacilityClinicianSchema = createInsertSchema(facilityClinicians).omit({
  id: true,
  createdAt: true,
});

export type FacilityClinician = typeof facilityClinicians.$inferSelect;
export type InsertFacilityClinician = z.infer<typeof insertFacilityClinicianSchema>;

/** Clinician source discriminator for batch attribution. */
export const CLINICIAN_SOURCES = ["facility_clinician", "free_text"] as const;
export type ClinicianSource = (typeof CLINICIAN_SOURCES)[number];
