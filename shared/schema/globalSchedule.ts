import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";

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
]);

export const insertGlobalScheduleEventSchema = createInsertSchema(globalScheduleEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GlobalScheduleEvent = typeof globalScheduleEvents.$inferSelect;
export type InsertGlobalScheduleEvent = z.infer<typeof insertGlobalScheduleEventSchema>;
