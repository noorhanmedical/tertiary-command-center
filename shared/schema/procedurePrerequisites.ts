// Phase 2F-B — configurable service-specific procedure prerequisites.
//
// Consent / insurance / authorization / coding are NOT universal procedure
// blockers. This companion table lets each clinic (or a platform default when
// clinic_id IS NULL) configure, per service + stage, whether a requirement is a
// hard procedure blocker, a soft operational warning, a documentation
// follow-up, a billing blocker, or a claim-submission blocker — and whether an
// authorized role may override it.
//
// Nothing here is read/written until FEATURE_CANONICAL_PROCEDURE_LIFECYCLE is
// ON and migration 0054 is applied. Additive + legacy-safe.

import {
  sql, pgTable, serial, text, integer, boolean, timestamp, index,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";

export const PREREQUISITE_BLOCKER_CATEGORIES = [
  "hard_procedure_blocker",
  "soft_operational_warning",
  "documentation_follow_up",
  "billing_blocker",
  "claim_submission_blocker",
] as const;
export type PrerequisiteBlockerCategory = (typeof PREREQUISITE_BLOCKER_CATEGORIES)[number];

export const PREREQUISITE_STAGES = [
  "scheduling",
  "check_in",
  "procedure_start",
  "billing",
  "claim_submission",
] as const;
export type PrerequisiteStage = (typeof PREREQUISITE_STAGES)[number];

export const ancillaryServicePrerequisiteConfig = pgTable(
  "ancillary_service_prerequisite_config",
  {
    id: serial("id").primaryKey(),
    // NULL clinic = platform default; a clinic row overrides the default.
    clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
    serviceType: text("service_type").notNull(),
    requirementCode: text("requirement_code").notNull(),
    blockerCategory: text("blocker_category").notNull(),
    blocksStage: text("blocks_stage").notNull(),
    required: boolean("required").notNull().default(true),
    overrideAllowed: boolean("override_allowed").notNull().default(false),
    // Comma-separated role list allowed to override (e.g. "admin,clinician").
    overrideRoles: text("override_roles"),
    overrideAuditRequired: boolean("override_audit_required").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_aspc_service").on(table.serviceType),
    index("idx_aspc_clinic").on(table.clinicId),
    // Deterministic uniqueness by clinic/default + service + requirement + stage
    // is created as a partial-unique pair in migration 0054 (NULL clinic vs set
    // clinic), which Drizzle's table API cannot model.
  ],
);

export const insertAncillaryServicePrerequisiteConfigSchema = createInsertSchema(
  ancillaryServicePrerequisiteConfig,
).omit({ id: true, createdAt: true, updatedAt: true });
export type AncillaryServicePrerequisiteConfig = typeof ancillaryServicePrerequisiteConfig.$inferSelect;
export type InsertAncillaryServicePrerequisiteConfig = z.infer<
  typeof insertAncillaryServicePrerequisiteConfigSchema
>;
