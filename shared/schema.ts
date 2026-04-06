import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, integer, timestamp, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/chat";

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const screeningBatches = pgTable("screening_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clinicianName: text("clinician_name"),
  patientCount: integer("patient_count").notNull().default(0),
  status: text("status").notNull().default("processing"),
  facility: text("facility"),
  scheduleDate: text("schedule_date"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
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
  insurance: text("insurance"),
  facility: text("facility"),
  diagnoses: text("diagnoses"),
  history: text("history"),
  medications: text("medications"),
  notes: text("notes"),
  qualifyingTests: text("qualifying_tests").array(),
  reasoning: jsonb("reasoning"),
  cooldownTests: jsonb("cooldown_tests"),
  status: text("status").notNull().default("pending"),
  appointmentStatus: text("appointment_status").notNull().default("pending"),
  patientType: text("patient_type").notNull().default("visit"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_patient_screenings_batch_id").on(table.batchId),
  index("idx_patient_screenings_status").on(table.status),
  index("idx_patient_screenings_appointment_status").on(table.appointmentStatus),
]);

export const insertPatientScreeningSchema = createInsertSchema(patientScreenings).omit({
  id: true,
  createdAt: true,
});

export type PatientScreening = typeof patientScreenings.$inferSelect;
export type InsertPatientScreening = z.infer<typeof insertPatientScreeningSchema>;

export const patientTestHistory = pgTable("patient_test_history", {
  id: serial("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  dob: text("dob"),
  testName: text("test_name").notNull(),
  dateOfService: text("date_of_service").notNull(),
  insuranceType: text("insurance_type").notNull().default("ppo"),
  clinic: text("clinic").notNull().default("NWPG"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_patient_test_history_patient_name").on(table.patientName),
  index("idx_patient_test_history_date_of_service").on(table.dateOfService),
]);

export const insertTestHistorySchema = createInsertSchema(patientTestHistory).omit({
  id: true,
  createdAt: true,
});

export type PatientTestHistory = typeof patientTestHistory.$inferSelect;
export type InsertTestHistory = z.infer<typeof insertTestHistorySchema>;

export const patientReferenceData = pgTable("patient_reference_data", {
  id: serial("id").primaryKey(),
  patientName: text("patient_name").notNull(),
  diagnoses: text("diagnoses"),
  history: text("history"),
  medications: text("medications"),
  age: text("age"),
  gender: text("gender"),
  insurance: text("insurance"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_patient_reference_data_patient_name").on(table.patientName),
]);

export const insertPatientReferenceSchema = createInsertSchema(patientReferenceData).omit({
  id: true,
  createdAt: true,
});

export type PatientReference = typeof patientReferenceData.$inferSelect;
export type InsertPatientReference = z.infer<typeof insertPatientReferenceSchema>;

export const generatedNotes = pgTable("generated_notes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientScreenings.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => screeningBatches.id, { onDelete: "cascade" }),
  facility: text("facility"),
  scheduleDate: text("schedule_date"),
  patientName: text("patient_name").notNull(),
  service: text("service").notNull(),
  docKind: text("doc_kind").notNull(),
  title: text("title").notNull(),
  sections: jsonb("sections").notNull(),
  generatedAt: timestamp("generated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  driveFileId: text("drive_file_id"),
  driveWebViewLink: text("drive_web_view_link"),
}, (table) => [
  index("idx_generated_notes_patient_id").on(table.patientId),
  index("idx_generated_notes_batch_id").on(table.batchId),
]);

export const insertGeneratedNoteSchema = createInsertSchema(generatedNotes).omit({
  id: true,
  generatedAt: true,
});

export type GeneratedNote = typeof generatedNotes.$inferSelect;
export type InsertGeneratedNote = z.infer<typeof insertGeneratedNoteSchema>;

export const testReasoningSchema = z.object({
  clinician_understanding: z.string(),
  patient_talking_points: z.string(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  qualifying_factors: z.array(z.string()).optional(),
  icd10_codes: z.array(z.string()).optional(),
  pearls: z.array(z.string()).optional(),
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

export const billingRecords = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patientScreenings.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => screeningBatches.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  facility: text("facility"),
  dateOfService: text("date_of_service"),
  patientName: text("patient_name").notNull(),
  clinician: text("clinician"),
  report: text("report"),
  insuranceInfo: text("insurance_info"),
  historicalProblemList: text("historical_problem_list"),
  comments: text("comments"),
  billing: text("billing"),
  nextAncillaries: text("next_ancillaries"),
  billingComments: text("billing_comments"),
  paid: boolean("paid").default(false),
  ptResponsibility: text("pt_responsibility"),
  billingComments2: text("billing_comments_2"),
  nextgenAppt: text("nextgen_appt"),
  billed: boolean("billed").default(false),
  drImranComments: text("dr_imran_comments"),
  response: text("response"),
  nwpgInvoiceSent: boolean("nwpg_invoice_sent").default(false),
  paidFinal: boolean("paid_final").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_billing_records_patient_id").on(table.patientId),
  index("idx_billing_records_batch_id").on(table.batchId),
  index("idx_billing_records_service").on(table.service),
  index("idx_billing_records_facility").on(table.facility),
]);

export const insertBillingRecordSchema = createInsertSchema(billingRecords).omit({
  id: true,
  createdAt: true,
});

export type BillingRecord = typeof billingRecords.$inferSelect;
export type InsertBillingRecord = z.infer<typeof insertBillingRecordSchema>;
