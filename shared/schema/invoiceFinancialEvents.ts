// invoice_adjustments + invoice_denials + remittance_events —
// Phase 4 PR 4.6.

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, numeric, index,
  createInsertSchema, z,
} from "./_common";
import { invoices, invoiceLineItems } from "./invoices";

export const INVOICE_ADJUSTMENT_TYPES = [
  "write_off", "contractual", "correction", "discount", "dispute_hold", "manual",
] as const;
export type InvoiceAdjustmentType = (typeof INVOICE_ADJUSTMENT_TYPES)[number];

export const invoiceAdjustments = pgTable("invoice_adjustments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  lineItemId: integer("line_item_id").references(() => invoiceLineItems.id, { onDelete: "set null" }),
  adjustmentType: text("adjustment_type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason"),
  actorUserId: text("actor_user_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_adjustments_invoice_id").on(table.invoiceId),
  index("idx_invoice_adjustments_type").on(table.adjustmentType),
]);

export const insertInvoiceAdjustmentSchema = createInsertSchema(invoiceAdjustments).omit({ id: true, createdAt: true });
export type InvoiceAdjustment = typeof invoiceAdjustments.$inferSelect;
export type InsertInvoiceAdjustment = z.infer<typeof insertInvoiceAdjustmentSchema>;

export const INVOICE_DENIAL_STATUSES = [
  "open", "appealed", "overturned", "upheld", "closed",
] as const;
export type InvoiceDenialStatus = (typeof INVOICE_DENIAL_STATUSES)[number];

export const invoiceDenials = pgTable("invoice_denials", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  lineItemId: integer("line_item_id").references(() => invoiceLineItems.id, { onDelete: "set null" }),
  denialCode: text("denial_code"),
  denialReason: text("denial_reason"),
  payer: text("payer"),
  status: text("status").notNull().default("open"),
  nextActionAt: timestamp("next_action_at"),
  actorUserId: text("actor_user_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_denials_invoice_id").on(table.invoiceId),
  index("idx_invoice_denials_status").on(table.status),
]);

export const insertInvoiceDenialSchema = createInsertSchema(invoiceDenials).omit({ id: true, createdAt: true, updatedAt: true });
export type InvoiceDenial = typeof invoiceDenials.$inferSelect;
export type InsertInvoiceDenial = z.infer<typeof insertInvoiceDenialSchema>;

export const REMITTANCE_EVENT_TYPES = [
  "remittance_received", "denial_received", "payment_posted", "adjustment_posted",
] as const;
export type RemittanceEventType = (typeof REMITTANCE_EVENT_TYPES)[number];

export const remittanceEvents = pgTable("remittance_events", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  payer: text("payer"),
  reference: text("reference"),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  eventType: text("event_type").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  actorUserId: text("actor_user_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_remittance_events_invoice_id").on(table.invoiceId),
  index("idx_remittance_events_event_type").on(table.eventType),
]);

export const insertRemittanceEventSchema = createInsertSchema(remittanceEvents).omit({ id: true, createdAt: true });
export type RemittanceEvent = typeof remittanceEvents.$inferSelect;
export type InsertRemittanceEvent = z.infer<typeof insertRemittanceEventSchema>;
