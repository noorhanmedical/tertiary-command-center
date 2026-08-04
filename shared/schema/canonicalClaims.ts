// Phase 2J — canonical claim attempts (migration 0056). A claim is a NEW
// downstream entity built from ONE exact current Billing Document evidence
// version. Never a Billing Document, invoice, payment, or remittance. Nothing
// reads/writes this until FEATURE_CANONICAL_CLAIMS is ON and 0056 is applied.
import {
  sql, pgTable, serial, text, varchar, integer, numeric, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";

// Server-owned claim lifecycle. Billing-ready ≠ claim-ready.
export const CANONICAL_CLAIM_STATUSES = [
  "not_ready", "ready", "draft", "queued", "submitted", "accepted", "rejected",
  "denied", "partially_paid", "paid", "voided", "superseded",
] as const;
export type CanonicalClaimStatus = (typeof CANONICAL_CLAIM_STATUSES)[number];
// Submitted (and beyond) are immutable historical states.
export const CANONICAL_CLAIM_TERMINAL_SUBMITTED: readonly CanonicalClaimStatus[] = [
  "submitted", "accepted", "rejected", "denied", "partially_paid", "paid",
] as const;
// A submitted status may be persisted ONLY from an exact authorized source.
export const CANONICAL_CLAIM_SUBMISSION_SOURCES = [
  "clearinghouse_response", "imported_acknowledgment", "manual_attestation",
] as const;
export type CanonicalClaimSubmissionSource = (typeof CANONICAL_CLAIM_SUBMISSION_SOURCES)[number];

// A claim charge amount may qualify ONLY when tagged with one of these EXACT
// approved provenance sources. An arbitrary/non-empty string NEVER qualifies — a
// missing approved source is a blocker, never a defaulted or invented amount.
export const CANONICAL_CLAIM_AMOUNT_SOURCES = [
  "approved_fee_schedule", "canonical_charge_config", "imported_charge", "authorized_manual_entry",
] as const;
export type CanonicalClaimAmountSource = (typeof CANONICAL_CLAIM_AMOUNT_SOURCES)[number];

// Every required claim field must come from an exact approved source; a missing
// one is a PHI-free blocker (never invented). Diagnosis/authorization are required
// only where the service/payer demands it — modeled as conditional blockers.
export const CANONICAL_CLAIM_REQUIRED_FIELDS = [
  "service_code", "units", "place_of_service", "rendering_provider",
  "billing_provider", "facility", "payer", "coverage_reference",
] as const;
export type CanonicalClaimRequiredField = (typeof CANONICAL_CLAIM_REQUIRED_FIELDS)[number];

export const canonicalClaims = pgTable("canonical_claims", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "no action" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  globalPlexusPatientId: integer("global_plexus_patient_id"),
  patientClinicMembershipId: integer("patient_clinic_membership_id"),
  serviceType: text("service_type").notNull(),
  billingDocumentId: integer("billing_document_id"),
  billingReadinessCheckId: integer("billing_readiness_check_id"),
  evidenceFingerprint: text("evidence_fingerprint"),
  orderNoteDocumentReferenceId: integer("order_note_document_reference_id"),
  reportDocumentReferenceId: integer("report_document_reference_id"),
  procedureNoteDocumentReferenceId: integer("procedure_note_document_reference_id"),
  procedureEventId: integer("procedure_event_id"),
  canonicalStatus: text("canonical_status").notNull().default("not_ready"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  supersedesClaimId: integer("supersedes_claim_id"),
  supersededAt: timestamp("superseded_at"),
  claimSubmissionBlockers: jsonb("claim_submission_blockers").notNull().default([]),
  warnings: jsonb("warnings").notNull().default([]),
  currency: text("currency").notNull().default("USD"),
  chargeAmount: numeric("charge_amount", { precision: 12, scale: 2 }),
  lineItems: jsonb("line_items").notNull().default([]),
  amountSource: text("amount_source"),
  // Exact validated claim fields + their approved provenance (persisted verbatim
  // from the readiness evaluator; never re-derived from arbitrary sourceData).
  claimFields: jsonb("claim_fields").notNull().default({}),
  fieldProvenance: jsonb("field_provenance").notNull().default({}),
  submittedAt: timestamp("submitted_at"),
  submissionSource: text("submission_source"),
  submissionReference: text("submission_reference"),
  submissionActorUserId: varchar("submission_actor_user_id"),
  submissionReason: text("submission_reason"),
  idempotencyKey: text("idempotency_key"),
  actorUserId: varchar("actor_user_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_cc_clinic").on(table.clinicId),
  index("idx_cc_ancillary_case").on(table.ancillaryCaseId),
  index("idx_cc_billing_document").on(table.billingDocumentId),
  index("idx_cc_status").on(table.canonicalStatus),
  index("idx_cc_supersedes").on(table.supersedesClaimId),
]);

export const insertCanonicalClaimSchema = createInsertSchema(canonicalClaims).omit({ id: true, createdAt: true, updatedAt: true });
export type CanonicalClaim = typeof canonicalClaims.$inferSelect;
export type InsertCanonicalClaim = z.infer<typeof insertCanonicalClaimSchema>;
