import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { globalScheduleEvents } from "./globalSchedule";
import { clinics } from "./clinics";

export const PROCEDURE_STATUSES = [
  "not_started",
  "in_progress",
  "paused",
  "complete",
  "cancelled",
  "no_show",
  "unable_to_complete",
  "reschedule_needed",
] as const;
export type ProcedureStatus = typeof PROCEDURE_STATUSES[number];

// Terminal states cannot be reopened through a general update route.
export const PROCEDURE_TERMINAL_STATUSES: readonly ProcedureStatus[] = [
  "complete", "cancelled", "no_show", "unable_to_complete",
];

export const procedureEvents = pgTable("procedure_events", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  globalScheduleEventId: integer("global_schedule_event_id").references(() => globalScheduleEvents.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  procedureStatus: text("procedure_status").notNull().default("not_started"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  note: text("note"),
  metadata: jsonb("metadata").default({}),
  // ── Phase 2F canonical procedure lifecycle identity (migration 0054) ──
  // Additive, nullable, legacy-safe. procedure_events remains the canonical
  // procedure execution/completion row; these columns anchor a completed
  // procedure to exactly one ancillary case as immutable Procedure Note
  // completion evidence (never patient-name / first / newest matching). FKs
  // are declared in migration 0054 only (a reverse import of
  // patientAncillaryCases / plexus identity here would risk a schema import
  // cycle — same pattern as procedure_notes' case-scoped links). All nullable
  // so legacy procedure_events writers stay valid while the flags are OFF.
  ancillaryCaseId: integer("ancillary_case_id"),
  globalPlexusPatientId: integer("global_plexus_patient_id"),
  patientClinicMembershipId: integer("patient_clinic_membership_id"),
  // ── Phase 2F-B procedure state-machine history (migration 0054) ──
  // All nullable + server-owned; legacy rows stay valid. Stamped only by the
  // dedicated clinic-scoped transition commands, never a client body.
  startedAt: timestamp("started_at"),
  pausedAt: timestamp("paused_at"),
  resumedAt: timestamp("resumed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  noShowAt: timestamp("no_show_at"),
  unableToCompleteAt: timestamp("unable_to_complete_at"),
  unableToCompleteReason: text("unable_to_complete_reason"),
  lastTransitionAt: timestamp("last_transition_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pe_execution_case_id").on(table.executionCaseId),
  index("idx_pe_patient_screening_id").on(table.patientScreeningId),
  index("idx_pe_global_schedule_event_id").on(table.globalScheduleEventId),
  index("idx_pe_facility_id").on(table.facilityId),
  index("idx_pe_service_type").on(table.serviceType),
  index("idx_pe_procedure_status").on(table.procedureStatus),
  index("idx_pe_ancillary_case").on(table.ancillaryCaseId),
]);

// General insert/create contract. It deliberately OMITS the canonical
// ownership/identity fields (clinicId + the Phase 2F case identity) and the
// server-owned timestamps: those are set EXCLUSIVELY by dedicated,
// clinic-scoped, server-owned repository commands
// (completeCanonicalProcedure / linkProcedureEventToAncillaryCase), never by a
// general Partial<InsertProcedureEvent> path — so a client body can never seed
// or re-home canonical ownership.
export const insertProcedureEventSchema = createInsertSchema(procedureEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  clinicId: true,
  ancillaryCaseId: true,
  globalPlexusPatientId: true,
  patientClinicMembershipId: true,
  startedAt: true,
  pausedAt: true,
  resumedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  noShowAt: true,
  unableToCompleteAt: true,
  unableToCompleteReason: true,
  lastTransitionAt: true,
});

export type ProcedureEvent = typeof procedureEvents.$inferSelect;
export type InsertProcedureEvent = z.infer<typeof insertProcedureEventSchema>;
