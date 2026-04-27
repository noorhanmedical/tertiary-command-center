import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { globalScheduleEvents } from "./globalSchedule";

export const PROCEDURE_STATUSES = [
  "not_started",
  "in_progress",
  "complete",
  "cancelled",
  "no_show",
  "reschedule_needed",
] as const;
export type ProcedureStatus = typeof PROCEDURE_STATUSES[number];

export const procedureEvents = pgTable("procedure_events", {
  id: serial("id").primaryKey(),
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
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pe_execution_case_id").on(table.executionCaseId),
  index("idx_pe_patient_screening_id").on(table.patientScreeningId),
  index("idx_pe_global_schedule_event_id").on(table.globalScheduleEventId),
  index("idx_pe_facility_id").on(table.facilityId),
  index("idx_pe_service_type").on(table.serviceType),
  index("idx_pe_procedure_status").on(table.procedureStatus),
]);

export const insertProcedureEventSchema = createInsertSchema(procedureEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProcedureEvent = typeof procedureEvents.$inferSelect;
export type InsertProcedureEvent = z.infer<typeof insertProcedureEventSchema>;
