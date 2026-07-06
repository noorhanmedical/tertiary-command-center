import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, index, numeric,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { billingRecords } from "./billing";
import { clinics } from "./clinics";

export const INVOICE_STATUSES = ["Draft", "Sent", "Partially Paid", "Paid"] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export const PAYMENT_METHODS = ["Check", "ACH", "Wire", "Credit Card", "Cash", "Other"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number").notNull().unique(),
  facility: text("facility").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  fromDate: text("from_date"),
  toDate: text("to_date"),
  status: text("status").notNull().default("Draft"),
  notes: text("notes"),
  totalCharges: numeric("total_charges", { precision: 12, scale: 2 }).notNull().default("0"),
  initialPaid: numeric("initial_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPaid: numeric("total_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  totalBalance: numeric("total_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  sentTo: text("sent_to"),
  sentAt: timestamp("sent_at"),
  lastRemindedAt: timestamp("last_reminded_at"),
  // Phase 4 PR 4.4 — approval workflow + draft provenance.
  // Approval lives alongside the legacy `status` text column so
  // existing billing pages continue to work unchanged.
  invoiceBatchId: integer("invoice_batch_id"),
  approvalStatus: text("approval_status").notNull().default("draft"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  voidedAt: timestamp("voided_at"),
  voidReason: text("void_reason"),
  policySnapshot: jsonb("policy_snapshot").notNull().default({}),
  recipientSnapshot: jsonb("recipient_snapshot").notNull().default({}),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  dueDate: text("due_date"),
  paymentTerms: text("payment_terms"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoices_facility").on(table.facility),
  index("idx_invoices_status").on(table.status),
  index("idx_invoices_invoice_date").on(table.invoiceDate),
  index("idx_invoices_approval_status").on(table.approvalStatus),
  index("idx_invoices_delivery_status").on(table.deliveryStatus),
  index("idx_invoices_invoice_batch_id").on(table.invoiceBatchId),
]);

export const INVOICE_APPROVAL_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "voided",
  "revised",
] as const;
export type InvoiceApprovalStatus = (typeof INVOICE_APPROVAL_STATUSES)[number];

export const INVOICE_DELIVERY_STATUSES = [
  "pending",
  "ready_to_send",
  "queued",
  "sent",
  "failed",
  "download_only",
  "blocked_missing_recipient",
  "blocked_not_approved",
] as const;
export type InvoiceDeliveryStatus = (typeof INVOICE_DELIVERY_STATUSES)[number];

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  sentTo: true,
  sentAt: true,
});
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  billingRecordId: integer("billing_record_id").references(() => billingRecords.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  dateOfService: text("date_of_service"),
  service: text("service").notNull(),
  mrn: text("mrn"),
  clinician: text("clinician"),
  totalCharges: numeric("total_charges", { precision: 10, scale: 2 }),
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }),
  balanceRemaining: numeric("balance_remaining", { precision: 10, scale: 2 }),
}, (table) => [
  index("idx_invoice_line_items_invoice_id").on(table.invoiceId),
]);

export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({ id: true });
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;

export const invoicePayments = pgTable("invoice_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: text("payment_date").notNull(),
  method: text("method").notNull().default("Check"),
  reference: text("reference"),
  note: text("note"),
  recordedByUserId: varchar("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_payments_invoice_id").on(table.invoiceId),
  index("idx_invoice_payments_payment_date").on(table.paymentDate),
]);

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments).omit({
  id: true,
  createdAt: true,
});
export type InvoicePayment = typeof invoicePayments.$inferSelect;
export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;
