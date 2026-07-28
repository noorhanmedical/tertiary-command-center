import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, boolean, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { billingReadinessChecks } from "./billingReadiness";
import { clinics } from "./clinics";

export const BILLING_DOCUMENT_REQUEST_STATUSES = [
  "pending",
  "generating",
  "generated",
  "failed",
  "sent_to_billing",
] as const;
export type BillingDocumentRequestStatus = typeof BILLING_DOCUMENT_REQUEST_STATUSES[number];

// Phase 2G — canonical Billing Document lifecycle statuses (stored in the
// additive canonical_status column that migration 0055 adds; legacy
// request_status is untouched).
export const CANONICAL_BILLING_DOCUMENT_STATUSES = [
  "pending",
  "generating",
  "generated",
  "approved",
  "failed",
  "superseded",
  "voided",
] as const;
export type CanonicalBillingDocumentStatus = typeof CANONICAL_BILLING_DOCUMENT_STATUSES[number];

// ─── LEGACY billing_document_requests (PRE-migration-0055 columns ONLY) ─────
// Kept pre-0055 so legacy repositories/routes stay executable while 0055 is
// unapplied and every Phase 2G flag is OFF. Phase 2G uses the separate
// canonicalBillingDocumentRequests object below (same physical table).
export const billingDocumentRequests = pgTable("billing_document_requests", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  billingReadinessCheckId: integer("billing_readiness_check_id").references(() => billingReadinessChecks.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  requestStatus: text("request_status").notNull().default("pending"),
  generatedDocumentId: integer("generated_document_id"),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_bdr_execution_case_id").on(table.executionCaseId),
  index("idx_bdr_patient_screening_id").on(table.patientScreeningId),
  index("idx_bdr_procedure_event_id").on(table.procedureEventId),
  index("idx_bdr_billing_readiness_check_id").on(table.billingReadinessCheckId),
  index("idx_bdr_service_type").on(table.serviceType),
  index("idx_bdr_request_status").on(table.requestStatus),
]);

export const insertBillingDocumentRequestSchema = createInsertSchema(billingDocumentRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BillingDocumentRequest = typeof billingDocumentRequests.$inferSelect;
export type InsertBillingDocumentRequest = z.infer<typeof insertBillingDocumentRequestSchema>;

// ─── CANONICAL billing_document_requests (PRE-0055 + migration-0055 columns) ─
// Maps to the SAME physical table; used ONLY by Phase 2G, only when the runtime
// flags are ON (0055 applied). No index definitions (legacy object owns them).
export const canonicalBillingDocumentRequests = pgTable("billing_document_requests", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id"),
  executionCaseId: integer("execution_case_id"),
  patientScreeningId: integer("patient_screening_id"),
  procedureEventId: integer("procedure_event_id"),
  billingReadinessCheckId: integer("billing_readiness_check_id"),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  requestStatus: text("request_status").notNull().default("pending"),
  generatedDocumentId: integer("generated_document_id"),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").notNull().default({}),
  // migration-0055 additive columns.
  ancillaryCaseId: integer("ancillary_case_id"),
  globalPlexusPatientId: integer("global_plexus_patient_id"),
  patientClinicMembershipId: integer("patient_clinic_membership_id"),
  reportDocumentReferenceId: integer("report_document_reference_id"),
  orderNoteDocumentReferenceId: integer("order_note_document_reference_id"),
  procedureNoteDocumentReferenceId: integer("procedure_note_document_reference_id"),
  canonicalStatus: text("canonical_status"),
  generatedBody: text("generated_body"),
  sourceData: jsonb("source_data").default({}),
  generationVersion: text("generation_version"),
  evidenceFingerprint: text("evidence_fingerprint"),
  claimBlockers: jsonb("claim_blockers").default([]),
  billingBlockers: jsonb("billing_blockers").default([]),
  warnings: jsonb("warnings").default([]),
  errorCode: text("error_code"),
  supersedesBillingDocumentId: integer("supersedes_billing_document_id"),
  supersededAt: timestamp("superseded_at"),
  generatedAt: timestamp("generated_at"),
  actorUserId: text("actor_user_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type CanonicalBillingDocumentRequest = typeof canonicalBillingDocumentRequests.$inferSelect;
