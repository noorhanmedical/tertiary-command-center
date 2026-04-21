import { sql, pgTable, serial, text, integer, timestamp, index, boolean, numeric, createInsertSchema, z } from "./_common";
import { patientScreenings, screeningBatches } from "./screening";

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
