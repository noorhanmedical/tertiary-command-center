import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, boolean, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { billingReadinessChecks } from "./billingReadiness";

export const BILLING_DOCUMENT_REQUEST_STATUSES = [
  "pending",
  "generating",
  "generated",
  "failed",
  "sent_to_billing",
] as const;
export type BillingDocumentRequestStatus = typeof BILLING_DOCUMENT_REQUEST_STATUSES[number];

export const billingDocumentRequests = pgTable("billing_document_requests", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  billingReadinessCheckId: integer("billing_readiness_check_id").references(() => billingReadinessChecks.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  requestStatus: text("request_status").notNull().default("pending"),
  generatedDocumentId: integer("generated_document_id"),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_bdr_execution_case_id").on(table.executionCaseId),
  index("idx_bdr_patient_screening_id").on(table.patientScreeningId),
  index("idx_bdr_procedure_event_id").on(table.procedureEventId),
  index("idx_bdr_billing_readiness_check_id").on(table.billingReadinessCheckId),
  index("idx_bdr_service_type").on(table.serviceType),
  index("idx_bdr_request_status").on(table.requestStatus),
]);

export const insertBillingDocumentRequestSchema = createInsertSchema(billingDocumentRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BillingDocumentRequest = typeof billingDocumentRequests.$inferSelect;
export type InsertBillingDocumentRequest = z.infer<typeof insertBillingDocumentRequestSchema>;
