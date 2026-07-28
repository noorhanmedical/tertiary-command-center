import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { clinics } from "./clinics";

export const BILLING_READINESS_STATUSES = [
  "not_ready",
  "missing_requirements",
  "ready_to_generate",
  "billing_document_generated",
  "sent_to_billing",
] as const;
export type BillingReadinessStatus = typeof BILLING_READINESS_STATUSES[number];

// Phase 2G — canonical case-scoped readiness statuses (stored in the additive
// canonical_status column; the legacy readiness_status column is untouched).
export const CANONICAL_BILLING_READINESS_STATUSES = [
  "missing_requirements",
  "ready_to_generate",
  "billing_document_pending",
  "billing_document_generated",
  "superseded",
  "invalidated",
  "migration_missing",
] as const;
export type CanonicalBillingReadinessStatus = typeof CANONICAL_BILLING_READINESS_STATUSES[number];

export const billingReadinessChecks = pgTable("billing_readiness_checks", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  readinessStatus: text("readiness_status").notNull().default("not_ready"),
  missingRequirements: jsonb("missing_requirements").notNull().default([]),
  readyAt: timestamp("ready_at"),
  metadata: jsonb("metadata").notNull().default({}),
  // ── Phase 2G canonical additive columns (migration 0055; all NULLABLE so the
  // legacy flags-OFF writer is never forced to populate them) ──
  ancillaryCaseId: integer("ancillary_case_id"),
  globalPlexusPatientId: integer("global_plexus_patient_id"),
  patientClinicMembershipId: integer("patient_clinic_membership_id"),
  reportDocumentReferenceId: integer("report_document_reference_id"),
  orderNoteDocumentReferenceId: integer("order_note_document_reference_id"),
  procedureNoteDocumentReferenceId: integer("procedure_note_document_reference_id"),
  canonicalStatus: text("canonical_status"),
  // Structured, PHI-free evidence + evaluation snapshot.
  billingBlockers: jsonb("billing_blockers").default([]),
  claimBlockers: jsonb("claim_blockers").default([]),
  warnings: jsonb("warnings").default([]),
  appliedOverrides: jsonb("applied_overrides").default([]),
  evidenceSnapshot: jsonb("evidence_snapshot").default({}),
  requirementVersion: text("requirement_version"),
  evidenceFingerprint: text("evidence_fingerprint"),
  evaluatorVersion: text("evaluator_version"),
  evaluatedAt: timestamp("evaluated_at"),
  supersededAt: timestamp("superseded_at"),
  actorUserId: text("actor_user_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_brc_execution_case_id").on(table.executionCaseId),
  index("idx_brc_patient_screening_id").on(table.patientScreeningId),
  index("idx_brc_procedure_event_id").on(table.procedureEventId),
  index("idx_brc_service_type").on(table.serviceType),
  index("idx_brc_readiness_status").on(table.readinessStatus),
  index("idx_brc_ancillary_case").on(table.ancillaryCaseId),
  index("idx_brc_clinic").on(table.clinicId),
]);

export const insertBillingReadinessCheckSchema = createInsertSchema(billingReadinessChecks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BillingReadinessCheck = typeof billingReadinessChecks.$inferSelect;
export type InsertBillingReadinessCheck = z.infer<typeof insertBillingReadinessCheckSchema>;
