// invoice_delivery_events — Phase 4 PR 4.5.

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { invoices } from "./invoices";

export const INVOICE_DELIVERY_EVENT_TYPES = [
  "queued",
  "sent",
  "failed",
  "reminder_sent",
  "download_generated",
  "blocked",
] as const;
export type InvoiceDeliveryEventType = (typeof INVOICE_DELIVERY_EVENT_TYPES)[number];

export const invoiceDeliveryEvents = pgTable("invoice_delivery_events", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  recipientSnapshot: jsonb("recipient_snapshot").notNull().default({}),
  actorUserId: text("actor_user_id"),
  messageId: text("message_id"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_delivery_invoice_id").on(table.invoiceId),
  index("idx_invoice_delivery_event_type").on(table.eventType),
  index("idx_invoice_delivery_created_at").on(table.createdAt),
]);

export const insertInvoiceDeliveryEventSchema = createInsertSchema(invoiceDeliveryEvents).omit({
  id: true,
  createdAt: true,
});
export type InvoiceDeliveryEvent = typeof invoiceDeliveryEvents.$inferSelect;
export type InsertInvoiceDeliveryEvent = z.infer<typeof insertInvoiceDeliveryEventSchema>;
