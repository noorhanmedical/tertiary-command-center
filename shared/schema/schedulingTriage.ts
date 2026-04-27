import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { globalScheduleEvents } from "./globalSchedule";

export const SCHEDULING_TRIAGE_MAIN_TYPES = [
  "new_patient",
  "returning_patient",
  "same_day_add",
  "reschedule",
  "cancellation",
  "no_show_follow_up",
  "insurance_verification",
  "authorization_pending",
  "facility_transfer",
  "outreach_callback",
] as const;
export type SchedulingTriageMainType = typeof SCHEDULING_TRIAGE_MAIN_TYPES[number];

export const SCHEDULING_TRIAGE_STATUSES = [
  "open",
  "in_progress",
  "pending_patient",
  "pending_insurance",
  "pending_facility",
  "resolved",
  "closed",
  "escalated",
] as const;
export type SchedulingTriageStatus = typeof SCHEDULING_TRIAGE_STATUSES[number];

export const SCHEDULING_TRIAGE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SchedulingTriagePriority = typeof SCHEDULING_TRIAGE_PRIORITIES[number];

export const schedulingTriageCases = pgTable("scheduling_triage_cases", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  globalScheduleEventId: integer("global_schedule_event_id").references(() => globalScheduleEvents.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  mainType: text("main_type").notNull(),
  subtype: text("subtype"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  nextOwnerRole: text("next_owner_role"),
  assignedUserId: varchar("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  dueAt: timestamp("due_at"),
  note: text("note"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_stc_execution_case_id").on(table.executionCaseId),
  index("idx_stc_patient_screening_id").on(table.patientScreeningId),
  index("idx_stc_global_schedule_event_id").on(table.globalScheduleEventId),
  index("idx_stc_facility_id").on(table.facilityId),
  index("idx_stc_main_type").on(table.mainType),
  index("idx_stc_status").on(table.status),
  index("idx_stc_assigned_user_id").on(table.assignedUserId),
  index("idx_stc_next_owner_role").on(table.nextOwnerRole),
]);

export const insertSchedulingTriageCaseSchema = createInsertSchema(schedulingTriageCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SchedulingTriageCase = typeof schedulingTriageCases.$inferSelect;
export type InsertSchedulingTriageCase = z.infer<typeof insertSchedulingTriageCaseSchema>;
