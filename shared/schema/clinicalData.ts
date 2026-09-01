// Canonical clinical reference domains for the Patient EHR chart.
//
// Prior to this module the EMR chart rendered providers / allergies / labs /
// imaging / vitals / encounters from a client-side demo enrichment layer
// (demoPatientData.ts) — real, DB-backed rows never existed. These six tables
// are the canonical source consumed by GET /api/patients/:screeningId/clinical-data
// and projected into the chart via emrModel. Every table keys on the owning
// patient_screening_id (the same id the rest of the chart fetches by) plus a
// denormalized patientName/patientDob for cross-screening identity matching.
//
// All migrations are ADDITIVE (migrations/0061_add_clinical_reference_domains.sql).

import {
  sql, pgTable, serial, text, integer, timestamp, boolean, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";
import { patientScreenings } from "./screening";

// ── 1. Providers / care team ────────────────────────────────────────────
export const patientClinicalProviders = pgTable("patient_clinical_providers", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  name: text("name").notNull(),
  role: text("role"),
  facility: text("facility"),
  /** referring | ordering | pcp | signing | interpreting | other */
  providerType: text("provider_type"),
  source: text("source").notNull().default("eCW"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_patient_clinical_providers_screening").on(t.patientScreeningId),
  index("idx_patient_clinical_providers_name").on(t.patientName),
]);

export const insertPatientClinicalProviderSchema = createInsertSchema(patientClinicalProviders).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientClinicalProvider = typeof patientClinicalProviders.$inferSelect;
export type InsertPatientClinicalProvider = z.infer<typeof insertPatientClinicalProviderSchema>;

// ── 2. Allergies ────────────────────────────────────────────────────────
export const patientAllergies = pgTable("patient_allergies", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  substance: text("substance").notNull(),
  reaction: text("reaction"),
  severity: text("severity"),
  source: text("source").notNull().default("eCW"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_patient_allergies_screening").on(t.patientScreeningId),
  index("idx_patient_allergies_name").on(t.patientName),
]);

export const insertPatientAllergySchema = createInsertSchema(patientAllergies).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientAllergy = typeof patientAllergies.$inferSelect;
export type InsertPatientAllergy = z.infer<typeof insertPatientAllergySchema>;

// ── 3. Labs (panel-grouped analytes) ────────────────────────────────────
export const LAB_FLAGS = ["normal", "high", "low", "critical"] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

export const patientLabs = pgTable("patient_labs", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  /** Panel this analyte belongs to (e.g. "CBC", "CMP", "Lipid Panel"). */
  panel: text("panel"),
  name: text("name").notNull(),
  value: text("value"),
  unit: text("unit"),
  referenceRange: text("reference_range"),
  /** ISO date (yyyy-mm-dd) of the draw. */
  collectedAt: text("collected_at"),
  flag: text("flag"),
  source: text("source").notNull().default("eCW"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_patient_labs_screening").on(t.patientScreeningId),
  index("idx_patient_labs_name").on(t.patientName),
  index("idx_patient_labs_panel").on(t.panel),
]);

export const insertPatientLabSchema = createInsertSchema(patientLabs).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientLab = typeof patientLabs.$inferSelect;
export type InsertPatientLab = z.infer<typeof insertPatientLabSchema>;

// ── 4. Imaging studies ──────────────────────────────────────────────────
export const patientImagingStudies = pgTable("patient_imaging_studies", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  study: text("study").notNull(),
  modality: text("modality"),
  performedAt: text("performed_at"),
  status: text("status"),
  impression: text("impression"),
  source: text("source").notNull().default("eCW"),
  reportAvailable: boolean("report_available").notNull().default(false),
  /** Optional link to a canonical document reference (report file). */
  reportDocumentReferenceId: integer("report_document_reference_id"),
  /** Optional ancillary service this study belongs to (e.g. "Bilateral Carotid Duplex"). */
  serviceType: text("service_type"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_patient_imaging_screening").on(t.patientScreeningId),
  index("idx_patient_imaging_name").on(t.patientName),
]);

export const insertPatientImagingStudySchema = createInsertSchema(patientImagingStudies).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientImagingStudy = typeof patientImagingStudies.$inferSelect;
export type InsertPatientImagingStudy = z.infer<typeof insertPatientImagingStudySchema>;

// ── 5. Vitals ───────────────────────────────────────────────────────────
export const patientVitals = pgTable("patient_vitals", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  label: text("label").notNull(),
  value: text("value"),
  unit: text("unit"),
  /** ISO date (yyyy-mm-dd) the vital was measured. */
  measuredAt: text("measured_at"),
  source: text("source").notNull().default("eCW"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_patient_vitals_screening").on(t.patientScreeningId),
  index("idx_patient_vitals_name").on(t.patientName),
]);

export const insertPatientVitalSchema = createInsertSchema(patientVitals).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientVital = typeof patientVitals.$inferSelect;
export type InsertPatientVital = z.infer<typeof insertPatientVitalSchema>;

// ── 6. Encounters / clinical notes ──────────────────────────────────────
export const patientEncounters = pgTable("patient_encounters", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  patientDob: text("patient_dob"),
  title: text("title").notNull(),
  kind: text("kind"),
  /** ISO date (yyyy-mm-dd) of the encounter. */
  occurredAt: text("occurred_at"),
  provider: text("provider"),
  /** Short one-line summary used in the collapsed row. */
  summary: text("summary"),
  /** Full note body rendered in the encounter drawer/modal (not inline). */
  noteBody: text("note_body"),
  /** Coarse category for filtering: primary_care | specialist | hospital | telephone | other */
  category: text("category"),
  tags: jsonb("tags").$type<string[]>(),
  source: text("source").notNull().default("eCW"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_patient_encounters_screening").on(t.patientScreeningId),
  index("idx_patient_encounters_name").on(t.patientName),
  index("idx_patient_encounters_occurred").on(t.occurredAt),
]);

export const insertPatientEncounterSchema = createInsertSchema(patientEncounters).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientEncounter = typeof patientEncounters.$inferSelect;
export type InsertPatientEncounter = z.infer<typeof insertPatientEncounterSchema>;

// ── 7. Episode documents (per-service, per-episode canonical document set) ──
// One row per document (order note, screening addendum, procedure note,
// consent, screening form, test report, billing document) scoped to a single
// service EPISODE (episodeKey). This is the single source the Plexus Notes &
// Documents section renders — episode-keyed so there is zero cross-episode
// document leakage. Narrative docs use bodyText; structured docs (screening
// form answers, report fields, billing line items) use structuredData.
export const EPISODE_DOCUMENT_TYPES = [
  "order_note", "screening_addendum", "procedure_note",
  "consent", "screening_form", "test_report", "billing_document",
] as const;
export type EpisodeDocumentType = (typeof EPISODE_DOCUMENT_TYPES)[number];

export const patientEpisodeDocuments = pgTable("patient_episode_documents", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  patientName: text("patient_name").notNull(),
  serviceType: text("service_type").notNull(),
  /** Stable per-episode key, e.g. "current", "2025", "2024". */
  episodeKey: text("episode_key").notNull(),
  episodeLabel: text("episode_label"),
  /** ISO date of service for this episode. */
  episodeDate: text("episode_date"),
  isCurrent: boolean("is_current").notNull().default(false),
  documentType: text("document_type").notNull(),
  title: text("title").notNull(),
  status: text("status"),
  /** Narrative content (notes/consent/addendum). */
  bodyText: text("body_text"),
  /** Structured content (screening answers, report fields, billing lines). */
  structuredData: jsonb("structured_data"),
  createdDate: text("created_date"),
  sentDate: text("sent_date"),
  completedDate: text("completed_date"),
  signedDate: text("signed_date"),
  finalizedDate: text("finalized_date"),
  authorName: text("author_name"),
  completedByName: text("completed_by_name"),
  signerName: text("signer_name"),
  version: integer("version").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_ped_screening").on(t.patientScreeningId),
  index("idx_ped_service_episode").on(t.serviceType, t.episodeKey),
  index("idx_ped_doc_type").on(t.documentType),
]);

export const insertPatientEpisodeDocumentSchema = createInsertSchema(patientEpisodeDocuments).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PatientEpisodeDocument = typeof patientEpisodeDocuments.$inferSelect;
export type InsertPatientEpisodeDocument = z.infer<typeof insertPatientEpisodeDocumentSchema>;

// ── 8. Document versions (edit lineage + diff for clinician-editable notes) ──
// Append-only version lineage for a patient_episode_documents row. Each row is
// one version (AI-generated original, admin-modified, clinician-modified,
// signed, post-signature amendment) with a structured `changes` diff so the UI
// can render "what changed / before / after / who / when".
export const patientDocumentVersions = pgTable("patient_document_versions", {
  id: serial("id").primaryKey(),
  episodeDocumentId: integer("episode_document_id")
    .references(() => patientEpisodeDocuments.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  /** plexus_iq | admin | clinician | system */
  authorRole: text("author_role"),
  authorName: text("author_name"),
  /** e.g. "Generated by Plexus IQ", "Admin Edited", "Clinician Edited", "Signed", "Amendment". */
  label: text("label").notNull(),
  bodyText: text("body_text"),
  /** Array of { field, action: modified|added|removed, before, after }. */
  changes: jsonb("changes").$type<Array<{ field: string; action: string; before?: string | null; after?: string | null }>>(),
  isSigned: boolean("is_signed").notNull().default(false),
  createdDate: text("created_date"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  index("idx_pdv_document").on(t.episodeDocumentId),
]);

export const insertPatientDocumentVersionSchema = createInsertSchema(patientDocumentVersions).omit({
  id: true, createdAt: true,
});
export type PatientDocumentVersion = typeof patientDocumentVersions.$inferSelect;
export type InsertPatientDocumentVersion = z.infer<typeof insertPatientDocumentVersionSchema>;
