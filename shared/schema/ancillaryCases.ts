// Phase 2B — Canonical per-service ancillary episode model.
//
// One row per (real-world patient episode of one ancillary service in
// one clinic). `patient_execution_cases` remains the outreach /
// engagement / scheduling-handoff container; a single execution case
// may reference many ancillary cases (one per selected service). See
// docs/full-patient-journey-platform-audit.md §4 for the operating
// model.
//
// Nothing in this file is used by any registered route or write path
// until FEATURE_ANCILLARY_CASE_WRITE is flipped ON and the migration
// (migrations/0050_add_patient_ancillary_cases.sql) is applied. The
// migration is NOT applied automatically.

import {
  sql,
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { clinics } from "./clinics";
import {
  globalPlexusPatients,
  patientClinicMemberships,
} from "./plexusIdentity";

// ─── Enums ──────────────────────────────────────────────────────
export const ANCILLARY_LIFECYCLE_STATUSES = [
  "new",
  "active",
  "on_hold",
  "closed",
  "cancelled",
  "archived",
] as const;
export type AncillaryLifecycleStatus =
  (typeof ANCILLARY_LIFECYCLE_STATUSES)[number];

// Statuses that count as "active" for the purpose of one-active-per-
// (patient, clinic, service). Referenced by the partial unique index
// in the migration and by the reconciliation service.
export const ANCILLARY_ACTIVE_LIFECYCLE_STATUSES: readonly AncillaryLifecycleStatus[] = [
  "new",
  "active",
  "on_hold",
] as const;

export const ANCILLARY_QUALIFICATION_STATUSES = [
  "unscreened",
  "qualified",
  "not_qualified",
  "pending_review",
] as const;
export type AncillaryQualificationStatus =
  (typeof ANCILLARY_QUALIFICATION_STATUSES)[number];

export const ANCILLARY_ADMIN_REVIEW_STATUSES = [
  "pending",
  "approved",
  "needs_info",
  "rejected",
] as const;
export type AncillaryAdminReviewStatus =
  (typeof ANCILLARY_ADMIN_REVIEW_STATUSES)[number];

// ─── patient_ancillary_cases ────────────────────────────────────
//
// FK delete behavior (matches the migration exactly):
//
//   global patient           → NO ACTION (deleting a live global
//                              patient with historical ancillary cases
//                              is unsupported; Plexus merge is the
//                              only intended path)
//   patient_clinic_membership → NO ACTION (same rationale)
//   clinic                    → NO ACTION (clinic deletion never
//                              silently orphans clinical history)
//   originating screening     → SET NULL (screening soft-delete /
//                              purge preserves the episode)
//   execution case            → SET NULL (execution case archive
//                              preserves the ancillary trail)
//
// Deliberately NOT declared here: `canonicalAppointmentId`.
// Appointment ownership lives on `global_schedule_events`, added in
// Phase 2D.
export const patientAncillaryCases = pgTable(
  "patient_ancillary_cases",
  {
    id: serial("id").primaryKey(),
    globalPlexusPatientId: integer("global_plexus_patient_id")
      .notNull()
      .references(() => globalPlexusPatients.id, { onDelete: "no action" }),
    patientClinicMembershipId: integer("patient_clinic_membership_id")
      .notNull()
      .references(() => patientClinicMemberships.id, { onDelete: "no action" }),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "no action" }),
    // FK to patient_screenings declared in the migration only — a
    // reverse import into shared/schema/screening.ts would introduce
    // a circular dependency (screening.ts already imports from this
    // file's peer plexusIdentity.ts). Same pattern used for
    // plexusIdentityLinkFailures in Phase 2A.
    originatingScreeningId: integer("originating_screening_id"),
    // FK to patient_execution_cases likewise declared in the migration
    // only. executionCase.ts is a large, load-bearing schema module
    // and reverse-importing this file would risk a cycle.
    executionCaseId: integer("execution_case_id"),
    serviceType: text("service_type").notNull(),
    episodeSequence: integer("episode_sequence").notNull().default(1),
    openedAt: timestamp("opened_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    closedAt: timestamp("closed_at"),
    lifecycleStatus: text("lifecycle_status").notNull().default("new"),
    qualificationStatus: text("qualification_status")
      .notNull()
      .default("unscreened"),
    adminReviewStatus: text("admin_review_status")
      .notNull()
      .default("pending"),
    clinicallyCompletedAt: timestamp("clinically_completed_at"),
    financiallyCompletedAt: timestamp("financially_completed_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_pac_global_patient").on(table.globalPlexusPatientId),
    index("idx_pac_membership").on(table.patientClinicMembershipId),
    index("idx_pac_clinic").on(table.clinicId),
    index("idx_pac_screening").on(table.originatingScreeningId),
    index("idx_pac_execution_case").on(table.executionCaseId),
    index("idx_pac_service_type").on(table.serviceType),
    index("idx_pac_lifecycle").on(table.lifecycleStatus),
    // Composite index supports both the active-lookup partial unique
    // index and the reconciliation service's active-case probe.
    index("idx_pac_active_lookup").on(
      table.globalPlexusPatientId,
      table.clinicId,
      table.serviceType,
    ),
    // Partial unique index (`uq_pac_active_episode`) is declared in
    // the migration — Drizzle's tables API does not model partial
    // indexes.
  ],
);

export const insertPatientAncillaryCaseSchema = createInsertSchema(
  patientAncillaryCases,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // openedAt and episodeSequence are server-owned via the
  // reconciliation service; client input cannot set them.
  openedAt: true,
  episodeSequence: true,
});
export type PatientAncillaryCase = typeof patientAncillaryCases.$inferSelect;
export type InsertPatientAncillaryCase = z.infer<
  typeof insertPatientAncillaryCaseSchema
>;

// ─── Journey event type catalog (Phase 2B additions) ────────────
//
// These event kinds are appended to the existing
// `patient_journey_events` table via `appendPatientJourneyEvent`.
// Kept as constants (not a Drizzle enum) so no schema migration is
// needed — the table's `event_type` column is TEXT.
export const ANCILLARY_JOURNEY_EVENT_TYPES = {
  created: "ancillary_case_created",
  reused: "ancillary_case_reused",
  statusChanged: "ancillary_case_status_changed",
  cancelled: "ancillary_case_cancelled",
  archived: "ancillary_case_archived",
  episodeRepeated: "ancillary_case_episode_repeated",
  reconciliationFailed: "ancillary_case_reconciliation_failed",
} as const;
export type AncillaryJourneyEventType =
  (typeof ANCILLARY_JOURNEY_EVENT_TYPES)[keyof typeof ANCILLARY_JOURNEY_EVENT_TYPES];
