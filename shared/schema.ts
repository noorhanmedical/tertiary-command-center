import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, boolean, numeric, AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/chat";

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const USER_ROLES = ["admin", "clinician", "scheduler", "biller"] as const;
export type UserRole = typeof USER_ROLES[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("clinician"),
  active: boolean("active").notNull().default(true),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
}).extend({
  role: z.enum(USER_ROLES).optional(),
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
  index("idx_patient_test_history_name_dob_test_dos").on(
    table.patientName,
    table.dob,
    table.testName,
    table.dateOfService,
  ),
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
  isTest: boolean("is_test").notNull().default(false),
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
  isTest: boolean("is_test").notNull().default(false),
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
  isTest: boolean("is_test").notNull().default(false),
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
  parentTaskId: integer("parent_task_id").references((): AnyPgColumn => plexusTasks.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull().default("task"),
  urgency: text("urgency").notNull().default("none"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  batchId: integer("batch_id").references(() => screeningBatches.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_plexus_tasks_project_id").on(table.projectId),
  index("idx_plexus_tasks_assigned_to").on(table.assignedToUserId),
  index("idx_plexus_tasks_created_by").on(table.createdByUserId),
  index("idx_plexus_tasks_status").on(table.status),
  index("idx_plexus_tasks_urgency").on(table.urgency),
  index("idx_plexus_tasks_batch_id").on(table.batchId),
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
  taskId: integer("task_id").references(() => plexusTasks.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => plexusProjects.id, { onDelete: "set null" }),
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

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_audit_log_user_id").on(table.userId),
  index("idx_audit_log_entity_type").on(table.entityType),
  index("idx_audit_log_created_at").on(table.createdAt),
]);

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, createdAt: true });
export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// ─── Outreach Schedulers ──────────────────────────────────────────────────────

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

// ─── Document Blobs (local FS-backed file persistence) ──────────────────────

export const documentBlobs = pgTable("document_blobs", {
  id: serial("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: integer("owner_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  sha256: text("sha256").notNull(),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_document_blobs_owner").on(table.ownerType, table.ownerId),
  index("idx_document_blobs_sha256").on(table.sha256),
]);

export const insertDocumentBlobSchema = createInsertSchema(documentBlobs).omit({
  id: true,
  createdAt: true,
});

export type DocumentBlob = typeof documentBlobs.$inferSelect;
export type InsertDocumentBlob = z.infer<typeof insertDocumentBlobSchema>;

// ─── Marketing Materials (catalog used by the Communication Hub) ────────────

export const marketingMaterials = pgTable("marketing_materials", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  sha256: text("sha256").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_marketing_materials_created_at").on(table.createdAt),
  index("idx_marketing_materials_sha256").on(table.sha256),
]);

export const insertMarketingMaterialSchema = createInsertSchema(marketingMaterials).omit({
  id: true,
  createdAt: true,
}).extend({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(1000).optional().default(""),
});

export type MarketingMaterial = typeof marketingMaterials.$inferSelect;
export type InsertMarketingMaterial = z.infer<typeof insertMarketingMaterialSchema>;

// ─── Outbox: pending uploads to Google Drive / Sheets ───────────────────────

export const OUTBOX_KINDS = [
  "drive_file",          // upload a blob (uploaded_document or generated_note) to Drive
  "sheet_billing",       // sync billing records to Sheets
  "sheet_patients",      // sync patient screenings to Sheets
] as const;
export type OutboxKind = typeof OUTBOX_KINDS[number];

export const OUTBOX_STATUSES = ["pending", "uploading", "completed", "failed"] as const;
export type OutboxStatus = typeof OUTBOX_STATUSES[number];

export const outboxItems = pgTable("outbox_items", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  // For drive_file: blobId points at document_blobs row.
  blobId: integer("blob_id"),
  // For drive_file: descriptive grouping.
  facility: text("facility"),
  patientName: text("patient_name"),
  ancillaryType: text("ancillary_type"),
  docKind: text("doc_kind"),
  // For drive_file: the resolved Drive folder id (computed at drain time if null).
  targetFolderId: text("target_folder_id"),
  // For sheet_*: spreadsheet id (resolved at drain time if null).
  targetSheetId: text("target_sheet_id"),
  filename: text("filename"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  errorText: text("error_text"),
  resultId: text("result_id"),
  resultUrl: text("result_url"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_outbox_items_status").on(table.status),
  index("idx_outbox_items_kind").on(table.kind),
  index("idx_outbox_items_is_test").on(table.isTest),
]);

export const insertOutboxItemSchema = createInsertSchema(outboxItems).omit({
  id: true,
  createdAt: true,
  lastAttemptAt: true,
  completedAt: true,
});

export type OutboxItem = typeof outboxItems.$inferSelect;
export type InsertOutboxItem = z.infer<typeof insertOutboxItemSchema>;

// ─── PTO Requests ────────────────────────────────────────────────────────────

export const PTO_STATUSES = ["pending", "approved", "denied"] as const;
export type PtoStatus = typeof PTO_STATUSES[number];

export const ptoRequests = pgTable("pto_requests", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pto_requests_user_id").on(table.userId),
  index("idx_pto_requests_status").on(table.status),
  index("idx_pto_requests_dates").on(table.startDate, table.endDate),
]);

export const insertPtoRequestSchema = createInsertSchema(ptoRequests).omit({
  id: true,
  createdAt: true,
  reviewedBy: true,
  reviewedAt: true,
  status: true,
}).extend({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  note: z.string().max(500).optional().nullable(),
});

export type PtoRequest = typeof ptoRequests.$inferSelect;
export type InsertPtoRequest = z.infer<typeof insertPtoRequestSchema>;

// ─── Outreach Calls ──────────────────────────────────────────────────────────

export const OUTREACH_CALL_OUTCOMES = [
  // Reached / engaged
  "reached",
  "scheduled",
  "callback",
  "wants_more_info",
  "will_think_about_it",
  "declined",
  "not_interested",
  "refused_dnc",
  "language_barrier",
  // Did not reach
  "no_answer",
  "voicemail",
  "mailbox_full",
  "busy",
  "hung_up",
  "disconnected",
  // Other / disqualifying
  "wrong_number",
  "moved",
  "deceased",
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

// ─── Scheduler Assignments ───────────────────────────────────────────────────
// One active assignment row per (patient, day). The call-list engine writes
// these so the same patient isn't double-served, and so reassignment is
// auditable. `source` records how the assignment came to be; `original_
// scheduler_id` is set whenever an assignment was reassigned away from
// someone (PTO, sudden absence, manual move).

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
  // The day this assignment is for (YYYY-MM-DD). Lets the engine be
  // idempotent per (facility, day) and lets queries filter to today.
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
  // One ACTIVE assignment per (patient,day) — enforces the engine
  // single-owner invariant at the DB level so race/retry can't duplicate.
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
