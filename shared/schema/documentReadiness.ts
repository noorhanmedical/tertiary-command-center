import {
  sql, pgTable, serial, text, varchar, boolean, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";

export const DOCUMENT_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
  "billing_document",
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export const DOCUMENT_STATUSES = [
  "missing",
  "pending",
  "uploaded",
  "generated",
  "approved",
  "completed",
  "blocked",
] as const;
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];

export const DOCUMENT_TRIGGERS = [
  "qualification_complete",
  "procedure_complete",
  "report_uploaded",
  "manual_upload",
  "billing_ready",
] as const;
export type DocumentTrigger = typeof DOCUMENT_TRIGGERS[number];

export const documentRequirements = pgTable("document_requirements", {
  id: serial("id").primaryKey(),
  serviceType: text("service_type").notNull(),
  documentType: text("document_type").notNull(),
  required: boolean("required").notNull().default(true),
  blocksBilling: boolean("blocks_billing").notNull().default(false),
  trigger: text("trigger").notNull(),
  facilityId: text("facility_id"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_doc_req_service_type").on(table.serviceType),
  index("idx_doc_req_document_type").on(table.documentType),
  index("idx_doc_req_facility_id").on(table.facilityId),
  index("idx_doc_req_active").on(table.active),
  index("idx_doc_req_trigger").on(table.trigger),
]);

export const insertDocumentRequirementSchema = createInsertSchema(documentRequirements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DocumentRequirement = typeof documentRequirements.$inferSelect;
export type InsertDocumentRequirement = z.infer<typeof insertDocumentRequirementSchema>;

export const caseDocumentReadiness = pgTable("case_document_readiness", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  documentType: text("document_type").notNull(),
  documentStatus: text("document_status").notNull().default("missing"),
  documentId: integer("document_id"),
  storageKey: text("storage_key"),
  blocksBilling: boolean("blocks_billing").notNull().default(false),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_cdr_execution_case_id").on(table.executionCaseId),
  index("idx_cdr_patient_screening_id").on(table.patientScreeningId),
  index("idx_cdr_facility_id").on(table.facilityId),
  index("idx_cdr_service_type").on(table.serviceType),
  index("idx_cdr_document_type").on(table.documentType),
  index("idx_cdr_document_status").on(table.documentStatus),
  index("idx_cdr_blocks_billing").on(table.blocksBilling),
]);

export const insertCaseDocumentReadinessSchema = createInsertSchema(caseDocumentReadiness).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CaseDocumentReadiness = typeof caseDocumentReadiness.$inferSelect;
export type InsertCaseDocumentReadiness = z.infer<typeof insertCaseDocumentReadinessSchema>;
