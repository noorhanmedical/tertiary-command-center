/**
 * Phase 3 — Plexus Clinical Findings.
 *
 * Structured AI-found (and human-confirmed) clinical findings that exist
 * independently of the EMR problem list. Each finding preserves full
 * provenance: which source document, what evidence, what confidence, and
 * what review state.
 *
 * This table is NOT gated behind a feature flag at the schema level.
 * Route-level access may be gated by admin role or a future
 * FEATURE_PLEXUS_FINDINGS flag if staged rollout is needed.
 */

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";
import { patientScreenings } from "./screening";
import { globalPlexusPatients } from "./plexusIdentity";

// ─── Enums ────────────────────────────────────────────────────────────────

export const FINDING_TYPES = [
  "diagnosis",
  "symptom",
  "medication_signal",
  "lab_abnormality",
  "imaging_finding",
  "history",
  "procedure_finding",
  "screening_finding",
  "other",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const FINDING_SOURCE_TYPES = [
  "diagnosis",
  "encounter",
  "note",
  "medication",
  "lab",
  "imaging",
  "procedure",
  "screening_form",
  "other",
] as const;
export type FindingSourceType = (typeof FINDING_SOURCE_TYPES)[number];

export const FINDING_REVIEW_STATUSES = [
  "ai_found",
  "needs_review",
  "confirmed",
  "modified",
  "rejected",
  "historical",
] as const;
export type FindingReviewStatus = (typeof FINDING_REVIEW_STATUSES)[number];

export const FINDING_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCE_LEVELS)[number];

// ─── Table ────────────────────────────────────────────────────────────────

export const plexusClinicalFindings = pgTable("plexus_clinical_findings", {
  id: serial("id").primaryKey(),

  // ─── Patient / facility scope ────────────────────────────────────
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  globalPlexusPatientId: integer("global_plexus_patient_id").references(
    () => globalPlexusPatients.id,
    { onDelete: "set null" },
  ),
  patientScreeningId: integer("patient_screening_id").references(
    () => patientScreenings.id,
    { onDelete: "set null" },
  ),
  facilityId: text("facility_id"),

  // ─── Clinical content ────────────────────────────────────────────
  findingType: text("finding_type").notNull(),
  displayName: text("display_name").notNull(),
  normalizedConcept: text("normalized_concept"),
  suggestedIcd10: text("suggested_icd10"),
  confirmedIcd10: text("confirmed_icd10"),

  // ─── Provenance / source ─────────────────────────────────────────
  sourceType: text("source_type").notNull(),
  sourceRecordId: text("source_record_id"),
  sourceDate: text("source_date"),
  sourceExcerpt: text("source_excerpt"),
  sourceValue: text("source_value"),

  // ─── AI metadata ─────────────────────────────────────────────────
  confidence: text("confidence"),
  aiModel: text("ai_model"),
  analysisRunId: integer("analysis_run_id"),

  // ─── Review state ────────────────────────────────────────────────
  reviewStatus: text("review_status").notNull().default("ai_found"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),

  // ─── Lifecycle ───────────────────────────────────────────────────
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pcf_clinic").on(table.clinicId),
  index("idx_pcf_global_patient").on(table.globalPlexusPatientId),
  index("idx_pcf_screening").on(table.patientScreeningId),
  index("idx_pcf_facility").on(table.facilityId),
  index("idx_pcf_finding_type").on(table.findingType),
  index("idx_pcf_source_type").on(table.sourceType),
  index("idx_pcf_review_status").on(table.reviewStatus),
  index("idx_pcf_suggested_icd10").on(table.suggestedIcd10),
  index("idx_pcf_analysis_run").on(table.analysisRunId),
]);

// ─── Schemas / Types ──────────────────────────────────────────────────────

export const insertPlexusClinicalFindingSchema = createInsertSchema(plexusClinicalFindings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PlexusClinicalFinding = typeof plexusClinicalFindings.$inferSelect;
export type InsertPlexusClinicalFinding = z.infer<typeof insertPlexusClinicalFindingSchema>;
