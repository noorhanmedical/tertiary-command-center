// Phase 2E — Unified Ancillary Documents reference index + canonical
// Order Note foundation types + reconciliation-failure ledger.
//
// Nothing in this file is used by any registered route or write path
// until FEATURE_UNIFIED_ANCILLARY_DOCUMENTS / FEATURE_CANONICAL_ORDER_NOTE
// are flipped ON and the migration
// (migrations/0053_add_unified_ancillary_documents.sql) is applied.
// The migration is NOT applied automatically.
//
// The reference table is an INDEX of canonical source records (Order
// Notes live in procedure_notes; reports/consent/screening forms live in
// the documents/upload store). It NEVER stores document bytes or full
// clinical note text — only immutable source IDs + status.

import {
  sql,
  pgTable,
  serial,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";

// ─── Allowed Phase 2E document kinds ────────────────────────────
// procedure_note is Phase 2F, billing_document is Phase 2G — NEITHER is
// a Phase 2E registry kind. (The wider case_document_readiness catalog
// separately tracks those; this reference index is Phase-2E-scoped.)
export const ANCILLARY_DOCUMENT_KINDS = [
  "order_note",
  "report",
  "consent",
  "screening_form",
] as const;
export type AncillaryDocumentKind = (typeof ANCILLARY_DOCUMENT_KINDS)[number];

// Reviewed workflow status values for a canonical document reference.
export const ANCILLARY_DOCUMENT_STATUSES = [
  "pending",
  "pending_signature",
  "signed",
  "uploaded",
  "superseded",
  "voided",
] as const;
export type AncillaryDocumentStatus =
  (typeof ANCILLARY_DOCUMENT_STATUSES)[number];

// Order Note signature requirement — unresolved by default (may be
// service-specific). We NEVER auto-sign in Phase 2E-A.
export const ORDER_NOTE_SIGNATURE_REQUIREMENTS = ["unresolved", "required", "not_required"] as const;
export type OrderNoteSignatureRequirement =
  (typeof ORDER_NOTE_SIGNATURE_REQUIREMENTS)[number];

// ─── ancillary_document_references ──────────────────────────────
export const ancillaryDocumentReferences = pgTable(
  "ancillary_document_references",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    // FKs to identity / screening / execution-case / ancillary-case
    // declared in the migration only (peer schema modules).
    globalPlexusPatientId: integer("global_plexus_patient_id"),
    patientClinicMembershipId: integer("patient_clinic_membership_id"),
    patientScreeningId: integer("patient_screening_id"),
    executionCaseId: integer("execution_case_id"),
    ancillaryCaseId: integer("ancillary_case_id").notNull(),
    documentKind: text("document_kind").notNull(),
    sourceSystem: text("source_system"),
    // The canonical source record — bytes/text stay there, never here.
    sourceTable: text("source_table").notNull(),
    sourceId: integer("source_id").notNull(),
    serviceType: text("service_type"),
    documentStatus: text("document_status").notNull(),
    // Timeless clinical date, distinct from the actual creation instant.
    effectiveClinicalDate: timestamp("effective_clinical_date"),
    actualCreatedAt: timestamp("actual_created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    signedAt: timestamp("signed_at"),
    supersededAt: timestamp("superseded_at"),
    createdByUserId: varchar("created_by_user_id"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_adr_clinic").on(table.clinicId),
    index("idx_adr_ancillary_case").on(table.ancillaryCaseId),
    index("idx_adr_screening").on(table.patientScreeningId),
    index("idx_adr_execution_case").on(table.executionCaseId),
    index("idx_adr_global_patient").on(table.globalPlexusPatientId),
    index("idx_adr_kind").on(table.documentKind),
  ],
);

export const insertAncillaryDocumentReferenceSchema = createInsertSchema(
  ancillaryDocumentReferences,
).omit({ id: true, actualCreatedAt: true, createdAt: true, updatedAt: true });
export type AncillaryDocumentReference =
  typeof ancillaryDocumentReferences.$inferSelect;
export type InsertAncillaryDocumentReference = z.infer<
  typeof insertAncillaryDocumentReferenceSchema
>;

// ─── ancillary_document_reconciliation_failures ─────────────────
export const ANCILLARY_DOCUMENT_FAILURE_ACTIONS = [
  "create_reference",
  "refresh_projection",
  "link_order_note",
  "link_report",
  "link_consent",
  "link_screening_form",
  "supersede_reference",
  // Order Note exists + case is approved, but the immutable
  // ancillary_case_admin_review_events evidence row is not yet resolvable
  // (migration/backfill state). Durable retry links admin_review_event_id
  // once the approved event surfaces — never fabricated up front.
  "link_order_note_evidence",
] as const;
export type AncillaryDocumentFailureAction =
  (typeof ANCILLARY_DOCUMENT_FAILURE_ACTIONS)[number];

export const ancillaryDocumentReconciliationFailures = pgTable(
  "ancillary_document_reconciliation_failures",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    ancillaryCaseId: integer("ancillary_case_id"),
    patientScreeningId: integer("patient_screening_id"),
    executionCaseId: integer("execution_case_id"),
    documentKind: text("document_kind"),
    sourceTable: text("source_table"),
    sourceId: integer("source_id"),
    requestedAction: text("requested_action").notNull(),
    sourceSystem: text("source_system"),
    errorCode: text("error_code"),
    attemptCount: integer("attempt_count").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    lastAttemptedAt: timestamp("last_attempted_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("idx_adrf_clinic").on(table.clinicId),
    index("idx_adrf_ancillary_case").on(table.ancillaryCaseId),
    index("idx_adrf_screening").on(table.patientScreeningId),
    index("idx_adrf_execution_case").on(table.executionCaseId),
  ],
);

export const insertAncillaryDocumentReconciliationFailureSchema =
  createInsertSchema(ancillaryDocumentReconciliationFailures).omit({
    id: true,
    firstFailedAt: true,
    lastAttemptedAt: true,
  });
export type AncillaryDocumentReconciliationFailure =
  typeof ancillaryDocumentReconciliationFailures.$inferSelect;
export type InsertAncillaryDocumentReconciliationFailure = z.infer<
  typeof insertAncillaryDocumentReconciliationFailureSchema
>;

// ─── Phase 2E journey/audit event catalog ───────────────────────
export const ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES = {
  referenceCreated: "ancillary_document_reference_created",
  referenceReused: "ancillary_document_reference_reused",
  orderNoteEligibilityEvaluated: "order_note_eligibility_evaluated",
  orderNoteCreated: "order_note_created",
  orderNoteReused: "order_note_reused",
  orderNotePendingSignature: "order_note_pending_signature",
  projectionFailed: "ancillary_document_projection_failed",
  reconciliationResolved: "ancillary_document_reconciliation_resolved",
  // Admin Review evidence was deferred AND the durable retry row could not
  // be persisted — surfaced so reconciliation durability is never overstated.
  evidenceRetryNotRecorded: "ancillary_document_evidence_retry_not_recorded",
} as const;
export type AncillaryDocumentJourneyEventType =
  (typeof ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES)[keyof typeof ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES];

// Canonical Order Note source lives in procedure_notes (note_type =
// 'order_note') — Phase 2E reuses it and never creates a competing note
// store. This constant documents the reference's source_table for Order
// Notes so readers/backfill agree.
export const ORDER_NOTE_SOURCE_TABLE = "procedure_notes";
