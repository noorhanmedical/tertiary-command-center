// Phase 2D — Canonical ancillary appointment domain types +
// reconciliation-failure ledger.
//
// Nothing in this file is used by any registered route or write path
// until FEATURE_CANONICAL_APPOINTMENT is flipped ON and the migration
// (migrations/0052_add_canonical_ancillary_appointments.sql) is
// applied. The migration is NOT applied automatically.

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

// ─── Canonical event-type + transition catalogs ─────────────────
//
// Only these `event_type` values qualify as a canonical ancillary
// appointment for Order Note eligibility and the partial-unique
// active-appointment index:
export const CANONICAL_ANCILLARY_EVENT_TYPES = [
  "ancillary_appointment",
  "same_day_add",
] as const;
export type CanonicalAncillaryEventType =
  (typeof CANONICAL_ANCILLARY_EVENT_TYPES)[number];

// `doctor_visit` is explicitly EXCLUDED. It is a general clinic
// appointment; it never auto-links to an ancillary case; it never
// satisfies Order Note eligibility.
export const NON_ANCILLARY_EVENT_TYPES = ["doctor_visit"] as const;

// Every canonical status.
export const CANONICAL_APPOINTMENT_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
] as const;
export type CanonicalAppointmentStatus =
  (typeof CANONICAL_APPOINTMENT_STATUSES)[number];

// Explicit transitions permitted by the domain service. Arbitrary
// status mutation is refused — every transition has its own helper.
export const CANONICAL_APPOINTMENT_TRANSITIONS = [
  "complete",
  "cancel",
  "no_show",
  "reschedule",
] as const;
export type CanonicalAppointmentTransition =
  (typeof CANONICAL_APPOINTMENT_TRANSITIONS)[number];

// ─── canonical_appointment_reconciliation_failures ──────────────
export const CANONICAL_APPOINTMENT_FAILURE_ACTIONS = [
  "create",
  "complete",
  "cancel",
  "no_show",
  "reschedule",
  "link_quick_schedule",
  "refresh_projection",
] as const;
export type CanonicalAppointmentFailureAction =
  (typeof CANONICAL_APPOINTMENT_FAILURE_ACTIONS)[number];

export const canonicalAppointmentReconciliationFailures = pgTable(
  "canonical_appointment_reconciliation_failures",
  {
    id: serial("id").primaryKey(),
    clinicId: integer("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    // FKs to ancillary_cases / patient_screenings / patient_execution_cases /
    // global_schedule_events declared in the migration only (peer schemas).
    ancillaryCaseId: integer("ancillary_case_id"),
    patientScreeningId: integer("patient_screening_id"),
    executionCaseId: integer("execution_case_id"),
    provisionalEventId: integer("provisional_event_id"),
    requestedAction: text("requested_action").notNull(),
    sourceSystem: text("source_system"),
    errorCode: text("error_code"),
    attemptCount: integer("attempt_count").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastAttemptedAt: timestamp("last_attempted_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("idx_carf_clinic").on(table.clinicId),
    index("idx_carf_ancillary_case").on(table.ancillaryCaseId),
    index("idx_carf_screening").on(table.patientScreeningId),
    index("idx_carf_execution_case").on(table.executionCaseId),
  ],
);

export const insertCanonicalAppointmentReconciliationFailureSchema =
  createInsertSchema(canonicalAppointmentReconciliationFailures).omit({
    id: true,
    firstFailedAt: true,
    lastAttemptedAt: true,
  });
export type CanonicalAppointmentReconciliationFailure =
  typeof canonicalAppointmentReconciliationFailures.$inferSelect;
export type InsertCanonicalAppointmentReconciliationFailure = z.infer<
  typeof insertCanonicalAppointmentReconciliationFailureSchema
>;

// ─── Phase 2D journey event catalog ─────────────────────────────
export const CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES = {
  created: "canonical_appointment_created",
  reused: "canonical_appointment_reused",
  completed: "canonical_appointment_completed",
  cancelled: "canonical_appointment_cancelled",
  noShow: "canonical_appointment_no_show",
  rescheduled: "canonical_appointment_rescheduled",
  projectionRefreshed: "canonical_appointment_projection_refreshed",
  quickScheduleLinked: "quick_schedule_linked",
  reconciliationFailed: "canonical_appointment_reconciliation_failed",
  reconciliationResolved: "canonical_appointment_reconciliation_resolved",
} as const;
export type CanonicalAppointmentJourneyEventType =
  (typeof CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES)[keyof typeof CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES];

/**
 * Statuses that qualify as an active/completed canonical ancillary
 * appointment for Order Note eligibility. Cancelled, no_show, and
 * rescheduled (historical prior events) do NOT qualify.
 */
export const ORDER_NOTE_QUALIFYING_STATUSES: readonly CanonicalAppointmentStatus[] = [
  "scheduled",
  "completed",
] as const;
