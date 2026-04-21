import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index, boolean, varchar,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";

export const screeningBatches = pgTable("screening_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clinicianName: text("clinician_name"),
  patientCount: integer("patient_count").notNull().default(0),
  status: text("status").notNull().default("processing"),
  facility: text("facility"),
  scheduleDate: text("schedule_date"),
  assignedSchedulerId: integer("assigned_scheduler_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  isTest: boolean("is_test").notNull().default(false),
}, (table) => [
  index("idx_screening_batches_status").on(table.status),
  index("idx_screening_batches_schedule_date").on(table.scheduleDate),
]);

export const insertScreeningBatchSchema = createInsertSchema(screeningBatches).omit({
  id: true,
  createdAt: true,
});

export type ScreeningBatch = typeof screeningBatches.$inferSelect;
export type InsertScreeningBatch = z.infer<typeof insertScreeningBatchSchema>;

export const patientScreenings = pgTable("patient_screenings", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => screeningBatches.id, { onDelete: "cascade" }),
  time: text("time"),
  name: text("name").notNull(),
  age: integer("age"),
  gender: text("gender"),
  dob: text("dob"),
  phoneNumber: text("phone_number"),
  email: text("email"),
  insurance: text("insurance"),
  facility: text("facility"),
  diagnoses: text("diagnoses"),
  history: text("history"),
  medications: text("medications"),
  previousTests: text("previous_tests"),
  previousTestsDate: text("previous_tests_date"),
  noPreviousTests: boolean("no_previous_tests").notNull().default(false),
  notes: text("notes"),
  qualifyingTests: text("qualifying_tests").array(),
  reasoning: jsonb("reasoning"),
  cooldownTests: jsonb("cooldown_tests"),
  status: text("status").notNull().default("pending"),
  appointmentStatus: text("appointment_status").notNull().default("pending"),
  patientType: text("patient_type").notNull().default("visit"),
  commitStatus: text("commit_status").notNull().default("Draft"),
  committedAt: timestamp("committed_at"),
  committedByUserId: varchar("committed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  isTest: boolean("is_test").notNull().default(false),
}, (table) => [
  index("idx_patient_screenings_batch_id").on(table.batchId),
  index("idx_patient_screenings_status").on(table.status),
  index("idx_patient_screenings_appointment_status").on(table.appointmentStatus),
  index("idx_patient_screenings_name_dob").on(table.name, table.dob),
  index("idx_patient_screenings_commit_status").on(table.commitStatus),
  index("idx_patient_screenings_committed_at").on(table.committedAt),
]);

export const COMMIT_STATUSES = ["Draft", "Ready", "WithScheduler", "Scheduled"] as const;
export type CommitStatus = typeof COMMIT_STATUSES[number];

/** Recall window in milliseconds — adders can undo a commit within this
 *  many ms of committedAt; after that the commit is locked in. */
export const COMMIT_RECALL_WINDOW_MS = 5 * 60 * 1000;

export const insertPatientScreeningSchema = createInsertSchema(patientScreenings).omit({
  id: true,
  createdAt: true,
});

export type PatientScreening = typeof patientScreenings.$inferSelect;
export type InsertPatientScreening = z.infer<typeof insertPatientScreeningSchema>;

export const testReasoningSchema = z.object({
  clinician_understanding: z.string(),
  patient_talking_points: z.string(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  qualifying_factors: z.array(z.string()).optional(),
  icd10_codes: z.array(z.string()).optional(),
  pearls: z.array(z.string()).optional(),
  approvalRequired: z.boolean().optional(),
});

export const patientScreeningResultSchema = z.object({
  time: z.string().optional(),
  name: z.string(),
  age: z.number().optional(),
  gender: z.string().optional(),
  diagnoses: z.string().optional(),
  history: z.string().optional(),
  medications: z.string().optional(),
  notes: z.string().optional(),
  qualifyingTests: z.array(z.string()),
  reasoning: z.record(z.string(), z.union([
    testReasoningSchema,
    z.string(),
  ])).optional(),
});

export type TestReasoning = z.infer<typeof testReasoningSchema>;
export type PatientScreeningResult = z.infer<typeof patientScreeningResultSchema>;
