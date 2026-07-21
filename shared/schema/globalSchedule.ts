import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { clinics } from "./clinics";

export const GLOBAL_SCHEDULE_EVENT_TYPES = [
  "doctor_visit",
  "ancillary_appointment",
  "team_member_availability",
  "pto_block",
  "sick_day",
  "unavailable_block",
  "room_block",
  "equipment_block",
  "same_day_add",
  "no_show",
  "cancellation",
  "reschedule",
  "procedure_complete",
] as const;
export type GlobalScheduleEventType = typeof GLOBAL_SCHEDULE_EVENT_TYPES[number];

export const GLOBAL_SCHEDULE_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "blocked",
  "pending_sync",
] as const;
export type GlobalScheduleStatus = typeof GLOBAL_SCHEDULE_STATUSES[number];

export const GLOBAL_SCHEDULE_SOURCES = [
  "manual",
  "screening_commit",
  "outreach_import",
  "pto_sync",
  "api_sync",
  "system_generated",
] as const;
export type GlobalScheduleSource = typeof GLOBAL_SCHEDULE_SOURCES[number];

export const globalScheduleEvents = pgTable("global_schedule_events", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  eventType: text("event_type").notNull(),
  serviceType: text("service_type"),
  source: text("source").notNull().default("manual"),
  status: text("status").notNull().default("scheduled"),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  assignedUserId: varchar("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedRole: text("assigned_role"),
  roomId: text("room_id"),
  equipmentId: text("equipment_id"),
  metadata: jsonb("metadata").default({}),
  // Phase 2D — canonical ancillary appointment linkage. Required by
  // domain validation for event_type IN ('ancillary_appointment',
  // 'same_day_add'); nullable at the DB layer so legacy rows continue
  // to compile. Migration 0052 adds a partial-unique index for one
  // active scheduled canonical ancillary appointment per case and a
  // CHECK constraint enforcing case-required for canonical types.
  // FK declared in the migration only (patient_ancillary_cases lives
  // in a peer schema module).
  ancillaryCaseId: integer("ancillary_case_id"),
  // Reschedule lineage. When a scheduled event is rescheduled, the
  // prior event is marked 'rescheduled' and a NEW event is inserted
  // with parent_event_id pointing back. Prior history is never
  // deleted or backdated.
  parentEventId: integer("parent_event_id"),
  // Required by CHECK when status='cancelled'.
  cancellationReason: text("cancellation_reason"),
  // Required by CHECK when status='no_show'.
  noShowReason: text("no_show_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_gse_facility_id").on(table.facilityId),
  index("idx_gse_event_type").on(table.eventType),
  index("idx_gse_status").on(table.status),
  index("idx_gse_starts_at").on(table.startsAt),
  index("idx_gse_assigned_user_id").on(table.assignedUserId),
  index("idx_gse_execution_case_id").on(table.executionCaseId),
  index("idx_gse_patient_screening_id").on(table.patientScreeningId),
  index("idx_gse_ancillary_case").on(table.ancillaryCaseId),
  index("idx_gse_parent_event").on(table.parentEventId),
]);

export const insertGlobalScheduleEventSchema = createInsertSchema(globalScheduleEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Phase 2D — parent_event_id is written only by the reschedule
  // transition helper. Client input never sets it.
  parentEventId: true,
});

export type GlobalScheduleEvent = typeof globalScheduleEvents.$inferSelect;
export type InsertGlobalScheduleEvent = z.infer<typeof insertGlobalScheduleEventSchema>;
