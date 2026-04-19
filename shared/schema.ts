import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, integer, timestamp, jsonb, index, boolean, numeric } from "drizzle-orm/pg-core";
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

export const billingRecords = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => patientScreenings.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => screeningBatches.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  facility: text("facility"),
  dateOfService: text("date_of_service"),
  patientName: text("patient_name").notNull(),
  dob: text("dob"),
  mrn: text("mrn"),
  clinician: text("clinician"),
  insuranceInfo: text("insurance_info"),
  documentationStatus: text("documentation_status"),
  billingStatus: text("billing_status").default("Not Billed"),
  response: text("response").default("Pending"),
  paidStatus: text("paid_status").default("Unpaid"),
  balanceRemaining: numeric("balance_remaining", { precision: 10, scale: 2 }),
  dateSubmitted: text("date_submitted"),
  followUpDate: text("follow_up_date"),
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }),
  insurancePaidAmount: numeric("insurance_paid_amount", { precision: 10, scale: 2 }),
  secondaryPaidAmount: numeric("secondary_paid_amount", { precision: 10, scale: 2 }),
  totalCharges: numeric("total_charges", { precision: 10, scale: 2 }),
  allowedAmount: numeric("allowed_amount", { precision: 10, scale: 2 }),
  patientResponsibility: numeric("patient_responsibility", { precision: 10, scale: 2 }),
  adjustmentAmount: numeric("adjustment_amount", { precision: 10, scale: 2 }),
  lastBillerUpdate: text("last_biller_update"),
  nextAction: text("next_action"),
  billingNotes: text("billing_notes"),
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

export const uploadedDocuments = pgTable("uploaded_documents", {
  id: serial("id").primaryKey(),
  facility: text("facility").notNull(),
  patientName: text("patient_name").notNull(),
  ancillaryType: text("ancillary_type").notNull(),
  docType: text("doc_type").notNull(),
  driveFileId: text("drive_file_id"),
  driveWebViewLink: text("drive_web_view_link"),
  uploadedAt: timestamp("uploaded_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUploadedDocumentSchema = createInsertSchema(uploadedDocuments).omit({
  id: true,
  uploadedAt: true,
});

export type UploadedDocument = typeof uploadedDocuments.$inferSelect;
export type InsertUploadedDocument = z.infer<typeof insertUploadedDocumentSchema>;

export const ancillaryAppointments = pgTable("ancillary_appointments", {
  id: serial("id").primaryKey(),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  facility: text("facility").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  testType: text("test_type").notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_ancillary_appointments_facility").on(table.facility),
  index("idx_ancillary_appointments_scheduled_date").on(table.scheduledDate),
  index("idx_ancillary_appointments_status").on(table.status),
]);

export const insertAncillaryAppointmentSchema = createInsertSchema(ancillaryAppointments).omit({
  id: true,
  createdAt: true,
});

export type AncillaryAppointment = typeof ancillaryAppointments.$inferSelect;
export type InsertAncillaryAppointment = z.infer<typeof insertAncillaryAppointmentSchema>;

export const analysisJobs = pgTable("analysis_jobs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => screeningBatches.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  totalPatients: integer("total_patients").notNull(),
  completedPatients: integer("completed_patients").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_analysis_jobs_batch_id").on(table.batchId),
  index("idx_analysis_jobs_status").on(table.status),
]);

export const insertAnalysisJobSchema = createInsertSchema(analysisJobs).omit({
  id: true,
  startedAt: true,
});

export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type InsertAnalysisJob = z.infer<typeof insertAnalysisJobSchema>;

// ─── Plexus Tasks ─────────────────────────────────────────────────────────────

export const plexusProjects = pgTable("plexus_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  projectType: text("project_type").notNull().default("operational"),
  facility: text("facility"),
  status: text("status").notNull().default("active"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_projects_created_by").on(table.createdByUserId),
  index("idx_plexus_projects_status").on(table.status),
]);

export const insertPlexusProjectSchema = createInsertSchema(plexusProjects).omit({ id: true, createdAt: true });
export type PlexusProject = typeof plexusProjects.$inferSelect;
export type InsertPlexusProject = z.infer<typeof insertPlexusProjectSchema>;

export const plexusTasks = pgTable("plexus_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => plexusProjects.id, { onDelete: "set null" }),
  parentTaskId: integer("parent_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull().default("task"),
  urgency: text("urgency").notNull().default("none"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_tasks_project_id").on(table.projectId),
  index("idx_plexus_tasks_assigned_to").on(table.assignedToUserId),
  index("idx_plexus_tasks_created_by").on(table.createdByUserId),
  index("idx_plexus_tasks_status").on(table.status),
  index("idx_plexus_tasks_urgency").on(table.urgency),
]);

export const insertPlexusTaskSchema = createInsertSchema(plexusTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type PlexusTask = typeof plexusTasks.$inferSelect;
export type InsertPlexusTask = z.infer<typeof insertPlexusTaskSchema>;

export const plexusTaskCollaborators = pgTable("plexus_task_collaborators", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => plexusTasks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("collaborator"),
  addedAt: timestamp("added_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_collab_task_id").on(table.taskId),
  index("idx_plexus_task_collab_user_id").on(table.userId),
]);

export const insertPlexusTaskCollaboratorSchema = createInsertSchema(plexusTaskCollaborators).omit({ id: true, addedAt: true });
export type PlexusTaskCollaborator = typeof plexusTaskCollaborators.$inferSelect;
export type InsertPlexusTaskCollaborator = z.infer<typeof insertPlexusTaskCollaboratorSchema>;

export const plexusTaskMessages = pgTable("plexus_task_messages", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => plexusTasks.id, { onDelete: "cascade" }),
  senderUserId: varchar("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_messages_task_id").on(table.taskId),
]);

export const insertPlexusTaskMessageSchema = createInsertSchema(plexusTaskMessages).omit({ id: true, createdAt: true });
export type PlexusTaskMessage = typeof plexusTaskMessages.$inferSelect;
export type InsertPlexusTaskMessage = z.infer<typeof insertPlexusTaskMessageSchema>;

export const plexusTaskEvents = pgTable("plexus_task_events", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => plexusTasks.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => plexusProjects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_events_task_id").on(table.taskId),
  index("idx_plexus_task_events_project_id").on(table.projectId),
]);

export const insertPlexusTaskEventSchema = createInsertSchema(plexusTaskEvents).omit({ id: true, createdAt: true });
export type PlexusTaskEvent = typeof plexusTaskEvents.$inferSelect;
export type InsertPlexusTaskEvent = z.infer<typeof insertPlexusTaskEventSchema>;

export const plexusTaskReads = pgTable("plexus_task_reads", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => plexusTasks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_task_reads_user_id").on(table.userId),
  index("idx_plexus_task_reads_task_id").on(table.taskId),
]);

export const insertPlexusTaskReadSchema = createInsertSchema(plexusTaskReads).omit({ id: true, lastReadAt: true });
export type PlexusTaskRead = typeof plexusTaskReads.$inferSelect;
export type InsertPlexusTaskRead = z.infer<typeof insertPlexusTaskReadSchema>;

// ─── Outreach Schedulers ──────────────────────────────────────────────────────

export const outreachSchedulers = pgTable("outreach_schedulers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  facility: text("facility").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_outreach_schedulers_facility").on(table.facility),
]);

export const insertOutreachSchedulerSchema = createInsertSchema(outreachSchedulers).omit({
  id: true,
  createdAt: true,
});

export type OutreachScheduler = typeof outreachSchedulers.$inferSelect;
export type InsertOutreachScheduler = z.infer<typeof insertOutreachSchedulerSchema>;
