/**
 * Phase 4 — Ancillary Service Registry.
 *
 * Centralizes all ancillary service definitions, CPT codes, qualification
 * criteria, cooldown rules, and template linkages into a single configurable
 * table. Adding a new service should primarily require inserting a row here
 * rather than editing scattered hardcoded logic throughout the platform.
 *
 * The `internal_code` is the stable programmatic identifier used across the
 * system (matching existing service_type strings in patient_ancillary_cases,
 * case_document_readiness, procedure_notes, etc.). The `display_name` is
 * the human-facing label.
 *
 * CPT codes are stored here but must be confirmed by the coding team before
 * being treated as billing truth in claim generation.
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
  uniqueIndex,
  boolean,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";

// ─── Enums ────────────────────────────────────────────────────────────────

export const SERVICE_CATEGORIES = [
  "neurocognitive",
  "autonomic",
  "cardiac",
  "vascular_carotid",
  "vascular_renal",
  "vascular_lower_arterial",
  "vascular_upper_arterial",
  "vascular_lower_venous",
  "vascular_upper_venous",
  "vascular_aortic",
  "stress_cardiac",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const ANATOMIC_REGIONS = [
  "brain",
  "autonomic",
  "heart",
  "carotid",
  "renal",
  "lower_extremity",
  "upper_extremity",
  "aorta",
] as const;
export type AnatomicRegion = (typeof ANATOMIC_REGIONS)[number];

// ─── Table ────────────────────────────────────────────────────────────────

export const ancillaryServiceRegistry = pgTable("ancillary_service_registry", {
  id: serial("id").primaryKey(),

  // ─── Identity ────────────────────────────────────────────────────
  /** Stable programmatic code used across all tables (matches existing service_type strings). */
  internalCode: text("internal_code").notNull().unique(),
  /** Human-facing display name. */
  displayName: text("display_name").notNull(),
  /** Service category for grouping. */
  category: text("category").notNull(),
  /** Anatomic region. */
  anatomicRegion: text("anatomic_region"),

  // ─── Status ──────────────────────────────────────────────────────
  /** Whether this service is globally active in the platform. */
  active: boolean("active").notNull().default(true),

  // ─── Billing / coding ────────────────────────────────────────────
  /** Primary CPT code. Must be confirmed by coding team before use in claims. */
  cptCode: text("cpt_code"),
  /** HCPCS code if applicable. */
  hcpcsCode: text("hcpcs_code"),
  /** Whether CPT has been confirmed by coding team. */
  cptConfirmed: boolean("cpt_confirmed").notNull().default(false),

  // ─── Qualification criteria (structured) ─────────────────────────
  /** Relevant diagnoses that support qualification. */
  qualifyingDiagnoses: jsonb("qualifying_diagnoses").default([]),
  /** Relevant ICD-10 codes. */
  relevantIcd10Codes: jsonb("relevant_icd10_codes").default([]),
  /** Relevant medications that signal eligibility. */
  relevantMedications: jsonb("relevant_medications").default([]),
  /** Relevant symptoms. */
  relevantSymptoms: jsonb("relevant_symptoms").default([]),
  /** Relevant lab findings. */
  relevantLabFindings: jsonb("relevant_lab_findings").default([]),
  /** Relevant imaging findings. */
  relevantImagingFindings: jsonb("relevant_imaging_findings").default([]),
  /** Relevant encounter findings. */
  relevantEncounterFindings: jsonb("relevant_encounter_findings").default([]),
  /** Inclusion criteria (free-text or structured). */
  inclusionCriteria: jsonb("inclusion_criteria").default([]),
  /** Exclusion criteria. */
  exclusionCriteria: jsonb("exclusion_criteria").default([]),

  // ─── AI qualification instructions per mode ──────────────────────
  /** Instructions appended to the AI prompt in permissive mode. */
  aiInstructionsPermissive: text("ai_instructions_permissive"),
  /** Instructions for standard mode. */
  aiInstructionsStandard: text("ai_instructions_standard"),
  /** Instructions for conservative mode. */
  aiInstructionsConservative: text("ai_instructions_conservative"),

  // ─── Cooldown rules ──────────────────────────────────────────────
  /** Default cooldown in months for Medicare payers. */
  cooldownMonthsMedicare: integer("cooldown_months_medicare"),
  /** Default cooldown in months for PPO/commercial payers. */
  cooldownMonthsPpo: integer("cooldown_months_ppo"),
  /** Default cooldown for other payer types. */
  cooldownMonthsOther: integer("cooldown_months_other"),

  // ─── Document template references ───────────────────────────────
  /** Whether informed consent is required. */
  requiresConsent: boolean("requires_consent").notNull().default(true),
  /** Whether a screening form is required. */
  requiresScreeningForm: boolean("requires_screening_form").notNull().default(true),
  /** Whether a test report is required. */
  requiresReport: boolean("requires_report").notNull().default(true),
  /** Whether clinician signature on Order Note is required. */
  requiresOrderSignature: boolean("requires_order_signature").notNull().default(true),
  /** Whether clinician signature on Procedure Note is required. */
  requiresProcedureNoteSignature: boolean("requires_procedure_note_signature").notNull().default(true),

  // ─── Billing blockers ────────────────────────────────────────────
  /** Structured list of what must be complete before billing. */
  billingBlockers: jsonb("billing_blockers").default([]),

  // ─── Sort / display ──────────────────────────────────────────────
  sortOrder: integer("sort_order").notNull().default(0),

  // ─── Lifecycle ───────────────────────────────────────────────────
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_asr_internal_code").on(table.internalCode),
  index("idx_asr_category").on(table.category),
  index("idx_asr_active").on(table.active),
  index("idx_asr_cpt").on(table.cptCode),
]);

// ─── Facility-level service enablement ────────────────────────────────────

export const facilityServiceSettings = pgTable("facility_service_settings", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  /** References ancillary_service_registry.internal_code (not FK to allow flexibility). */
  serviceCode: text("service_code").notNull(),
  /** Whether this service is enabled at this facility. */
  enabled: boolean("enabled").notNull().default(true),
  /** Facility-specific qualification mode override (null = use facility default). */
  qualificationModeOverride: text("qualification_mode_override"),
  /** Facility-specific cooldown override in months (null = use registry default). */
  cooldownMonthsOverride: integer("cooldown_months_override"),
  /** Additional facility-specific configuration. */
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_fss_clinic_service").on(table.clinicId, table.serviceCode),
  index("idx_fss_clinic").on(table.clinicId),
  index("idx_fss_service").on(table.serviceCode),
]);

// ─── Schemas / Types ──────────────────────────────────────────────────────

export const insertAncillaryServiceRegistrySchema = createInsertSchema(ancillaryServiceRegistry).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFacilityServiceSettingsSchema = createInsertSchema(facilityServiceSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AncillaryServiceRegistryEntry = typeof ancillaryServiceRegistry.$inferSelect;
export type InsertAncillaryServiceRegistryEntry = z.infer<typeof insertAncillaryServiceRegistrySchema>;
export type FacilityServiceSetting = typeof facilityServiceSettings.$inferSelect;
export type InsertFacilityServiceSetting = z.infer<typeof insertFacilityServiceSettingsSchema>;
