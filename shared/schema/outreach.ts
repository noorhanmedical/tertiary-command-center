import {
  sql, pgTable, serial, text, varchar, integer, timestamp, index, uniqueIndex, AnyPgColumn,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientScreenings } from "./screening";

export const outreachSchedulers = pgTable("outreach_schedulers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  facility: text("facility").notNull(),
  capacityPercent: integer("capacity_percent").notNull().default(100),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_outreach_schedulers_facility").on(table.facility),
  index("idx_outreach_schedulers_user_id").on(table.userId),
]);

export const insertOutreachSchedulerSchema = createInsertSchema(outreachSchedulers).omit({
  id: true,
  createdAt: true,
});

export type OutreachScheduler = typeof outreachSchedulers.$inferSelect;
export type InsertOutreachScheduler = z.infer<typeof insertOutreachSchedulerSchema>;

export const OUTREACH_CALL_OUTCOMES = [
  "reached", "scheduled", "callback", "wants_more_info", "will_think_about_it",
  "declined", "not_interested", "refused_dnc", "language_barrier",
  "no_answer", "voicemail", "mailbox_full", "busy", "hung_up", "disconnected",
  "wrong_number", "moved", "deceased",
] as const;
export type OutreachCallOutcome = typeof OUTREACH_CALL_OUTCOMES[number];

export const outreachCalls = pgTable("outreach_calls", {
  id: serial("id").primaryKey(),
  patientScreeningId: integer("patient_screening_id")
    .notNull()
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  schedulerUserId: varchar("scheduler_user_id").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  outcome: text("outcome").notNull(),
  notes: text("notes"),
  callbackAt: timestamp("callback_at"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  durationSeconds: integer("duration_seconds"),
}, (table) => [
  index("idx_outreach_calls_patient").on(table.patientScreeningId),
  index("idx_outreach_calls_scheduler").on(table.schedulerUserId),
  index("idx_outreach_calls_started_at").on(table.startedAt),
  index("idx_outreach_calls_callback_at").on(table.callbackAt),
]);

export const insertOutreachCallSchema = createInsertSchema(outreachCalls).omit({
  id: true,
  startedAt: true,
}).extend({
  outcome: z.enum(OUTREACH_CALL_OUTCOMES),
  notes: z.string().max(2000).optional().nullable(),
  callbackAt: z.coerce.date().optional().nullable(),
  attemptNumber: z.number().int().min(1).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional().nullable(),
});

export type OutreachCall = typeof outreachCalls.$inferSelect;
export type InsertOutreachCall = z.infer<typeof insertOutreachCallSchema>;

export const SCHEDULER_ASSIGNMENT_SOURCES = ["auto", "manual", "reassigned"] as const;
export type SchedulerAssignmentSource = typeof SCHEDULER_ASSIGNMENT_SOURCES[number];

export const SCHEDULER_ASSIGNMENT_STATUSES = ["active", "completed", "reassigned", "released"] as const;
export type SchedulerAssignmentStatus = typeof SCHEDULER_ASSIGNMENT_STATUSES[number];

export const schedulerAssignments = pgTable("scheduler_assignments", {
  id: serial("id").primaryKey(),
  patientScreeningId: integer("patient_screening_id")
    .notNull()
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  schedulerId: integer("scheduler_id")
    .notNull()
    .references(() => outreachSchedulers.id, { onDelete: "cascade" }),
  asOfDate: text("as_of_date").notNull(),
  assignedAt: timestamp("assigned_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  source: text("source").notNull().default("auto"),
  originalSchedulerId: integer("original_scheduler_id").references(
    (): AnyPgColumn => outreachSchedulers.id,
    { onDelete: "set null" },
  ),
  reason: text("reason"),
  status: text("status").notNull().default("active"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_scheduler_assignments_scheduler_status")
    .on(table.schedulerId, table.status),
  index("idx_scheduler_assignments_patient_status")
    .on(table.patientScreeningId, table.status),
  index("idx_scheduler_assignments_as_of_date").on(table.asOfDate),
  uniqueIndex("uq_scheduler_assignments_active_per_patient_day")
    .on(table.patientScreeningId, table.asOfDate)
    .where(sql`status = 'active'`),
]);

export const insertSchedulerAssignmentSchema = createInsertSchema(schedulerAssignments).omit({
  id: true,
  assignedAt: true,
  completedAt: true,
}).extend({
  source: z.enum(SCHEDULER_ASSIGNMENT_SOURCES).optional(),
  status: z.enum(SCHEDULER_ASSIGNMENT_STATUSES).optional(),
  reason: z.string().max(500).optional().nullable(),
});

export type SchedulerAssignment = typeof schedulerAssignments.$inferSelect;
export type InsertSchedulerAssignment = z.infer<typeof insertSchedulerAssignmentSchema>;
