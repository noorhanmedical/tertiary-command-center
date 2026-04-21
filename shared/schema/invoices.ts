import {
  sql, pgTable, serial, text, varchar, integer, timestamp, index, numeric,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { billingRecords } from "./billing";

export const INVOICE_STATUSES = ["Draft", "Sent", "Partially Paid", "Paid"] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export const PAYMENT_METHODS = ["Check", "ACH", "Wire", "Credit Card", "Cash", "Other"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
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
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoices_facility").on(table.facility),
  index("idx_invoices_status").on(table.status),
  index("idx_invoices_invoice_date").on(table.invoiceDate),
]);

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
