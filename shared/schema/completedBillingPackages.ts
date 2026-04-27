import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, boolean, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { billingReadinessChecks } from "./billingReadiness";
import { billingDocumentRequests } from "./billingDocuments";
import { users } from "./users";

export const PACKAGE_STATUSES = [
  "pending_payment",
  "payment_updated",
  "completed_package",
  "added_to_invoice",
  "invoiced",
  "closed",
] as const;
export type PackageStatus = typeof PACKAGE_STATUSES[number];

export const PAYMENT_STATUSES = [
  "not_received",
  "pending",
  "updated",
  "disputed",
  "reversed",
] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export const completedBillingPackages = pgTable("completed_billing_packages", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  billingReadinessCheckId: integer("billing_readiness_check_id").references(() => billingReadinessChecks.id, { onDelete: "set null" }),
  billingDocumentRequestId: integer("billing_document_request_id").references(() => billingDocumentRequests.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientInitials: text("patient_initials"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  dos: text("dos"),
  packageStatus: text("package_status").notNull().default("pending_payment"),
  paymentStatus: text("payment_status").notNull().default("not_received"),
  fullAmountPaid: text("full_amount_paid"),
  paymentDate: text("payment_date"),
  paymentUpdatedByUserId: varchar("payment_updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  paymentUpdatedAt: timestamp("payment_updated_at"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_cbp_execution_case_id").on(table.executionCaseId),
  index("idx_cbp_patient_screening_id").on(table.patientScreeningId),
  index("idx_cbp_procedure_event_id").on(table.procedureEventId),
  index("idx_cbp_billing_readiness_check_id").on(table.billingReadinessCheckId),
  index("idx_cbp_billing_document_request_id").on(table.billingDocumentRequestId),
  index("idx_cbp_facility_id").on(table.facilityId),
  index("idx_cbp_service_type").on(table.serviceType),
  index("idx_cbp_package_status").on(table.packageStatus),
  index("idx_cbp_payment_status").on(table.paymentStatus),
]);

export const insertCompletedBillingPackageSchema = createInsertSchema(completedBillingPackages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CompletedBillingPackage = typeof completedBillingPackages.$inferSelect;
export type InsertCompletedBillingPackage = z.infer<typeof insertCompletedBillingPackageSchema>;
