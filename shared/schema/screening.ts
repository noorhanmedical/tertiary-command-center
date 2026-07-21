import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index, boolean, varchar,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";
// Phase 2A — transitional identity linkage. `plexusIdentity.ts` does NOT
// import from this file, so this reverse import introduces no cycle.
import {
  globalPlexusPatients,
  patientClinicMemberships,
} from "./plexusIdentity";

export const screeningBatches = pgTable("screening_batches", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  clinicianName: text("clinician_name"),
  patientCount: integer("patient_count").notNull().default(0),
  status: text("status").notNull().default("processing"),
  facility: text("facility"),
  scheduleDate: text("schedule_date"),
  assignedSchedulerId: integer("assigned_scheduler_id"),
  // Import-session tracking (task: Patient EHR import history).
  // Non-null only for batches created by the Patient EHR bulk
  // import flow. `importSourceFields` records the column headers
  // detected in the pasted file; `importKind` is "full" | "service"
  // (service = minimal-field import, e.g. Date of Service / Patient /
  // Procedure only); `importCreatedBy` is the importing user id;
  // `pendingImportPayload` temporarily stores the parsed preview rows
  // when a non-admin submits a minimal import for admin approval.
  importSourceFields: jsonb("import_source_fields"),
  importKind: text("import_kind"),
  importCreatedBy: varchar("import_created_by"),
  pendingImportPayload: jsonb("pending_import_payload"),
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
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
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
  // Soft-delete fields. A patient with `deletedAt IS NOT NULL` is hidden
  // from every normal workspace/calendar/analysis query. `deleteExpiresAt`
  // is the cutoff after which restore is no longer offered (default 14
  // days from delete time). All four fields are populated together by
  // the soft-delete repository method and cleared together by restore.
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deleteExpiresAt: timestamp("delete_expires_at"),
  deleteReason: text("delete_reason"),
  // Admin approval gate before Send to Engagement. Default `pending`
  // so newly imported patients require explicit admin sign-off
  // before they can be sent to the engagement spine. Backend
  // `commitPatient` honors this in addition to its existing
  // name/dob/phone validation.
  adminApprovalStatus: text("admin_approval_status").notNull().default("pending"),
  adminApprovedAt: timestamp("admin_approved_at"),
  adminApprovedByUserId: varchar("admin_approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  adminApprovalNote: text("admin_approval_note"),
  // Phase 2A — transitional Plexus identity linkage. Populated by the
  // shared identity orchestrator (server-side only) after every insert,
  // or by the backfill script. Both nullable during the transition and
  // remain nullable when FEATURE_PLEXUS_IDENTITY_WRITE is OFF. NEVER
  // accepted from client input — insertPatientScreeningSchema omits them.
  patientClinicMembershipId: integer("patient_clinic_membership_id").references(
    () => patientClinicMemberships.id,
    { onDelete: "set null" },
  ),
  globalPlexusPatientId: integer("global_plexus_patient_id").references(
    () => globalPlexusPatients.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  isTest: boolean("is_test").notNull().default(false),
}, (table) => [
  index("idx_patient_screenings_batch_id").on(table.batchId),
  index("idx_patient_screenings_status").on(table.status),
  index("idx_patient_screenings_appointment_status").on(table.appointmentStatus),
  index("idx_patient_screenings_name_dob").on(table.name, table.dob),
  index("idx_patient_screenings_commit_status").on(table.commitStatus),
  index("idx_patient_screenings_committed_at").on(table.committedAt),
  index("idx_patient_screenings_deleted_at").on(table.deletedAt),
  index("idx_patient_screenings_delete_expires_at").on(table.deleteExpiresAt),
  index("idx_patient_screenings_admin_approval_status").on(table.adminApprovalStatus),
  index("idx_ps_pcm").on(table.patientClinicMembershipId),
  index("idx_ps_gpp").on(table.globalPlexusPatientId),
]);

export const ADMIN_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "needs_info",
  "rejected",
] as const;
export type AdminApprovalStatus = (typeof ADMIN_APPROVAL_STATUSES)[number];

export const COMMIT_STATUSES = ["Draft", "Ready", "WithScheduler", "Scheduled"] as const;
export type CommitStatus = typeof COMMIT_STATUSES[number];

/** Recall window in milliseconds — adders can undo a commit within this
 *  many ms of committedAt; after that the commit is locked in. */
export const COMMIT_RECALL_WINDOW_MS = 5 * 60 * 1000;

export const insertPatientScreeningSchema = createInsertSchema(patientScreenings).omit({
  id: true,
  createdAt: true,
  // Server-owned Phase 2A linkage — never accepted from client input.
  // Populated exclusively by the shared identity orchestrator or the
  // Phase 2A backfill script.
  patientClinicMembershipId: true,
  globalPlexusPatientId: true,
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
  // Admin-authored justification for *this specific* qualifying test.
  // Free-form string, optional. Persists through the canonical
  // patient_screenings.reasoning jsonb column — no separate store.
  admin_justification: z.string().optional(),
  admin_justification_updated_at: z.string().optional(),
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
