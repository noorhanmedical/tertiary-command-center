// invoice_batches + invoice_batch_items — Phase 4 PR 4.3.

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index, numeric,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { invoiceReadinessSnapshots } from "./invoiceReadiness";
import { clinics } from "./clinics";

export const INVOICE_BATCH_STATUSES = [
  "draft_preview",
  "ready_for_review",
  "invoice_drafts_created",
  "voided",
] as const;
export type InvoiceBatchStatus = (typeof INVOICE_BATCH_STATUSES)[number];

export const invoiceBatches = pgTable("invoice_batches", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  facilityId: text("facility_id").notNull(),
  invoicePeriodStart: text("invoice_period_start").notNull(),
  invoicePeriodEnd: text("invoice_period_end").notNull(),
  cutoffAt: timestamp("cutoff_at").notNull(),
  batchStatus: text("batch_status").notNull().default("draft_preview"),
  policySnapshot: jsonb("policy_snapshot").notNull().default({}),
  recipientSnapshot: jsonb("recipient_snapshot").notNull().default({}),
  totals: jsonb("totals").notNull().default({}),
  itemCount: integer("item_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  createdByUserId: text("created_by_user_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_batches_facility_id").on(table.facilityId),
  index("idx_invoice_batches_status").on(table.batchStatus),
  index("idx_invoice_batches_period").on(table.invoicePeriodStart, table.invoicePeriodEnd),
]);

export const insertInvoiceBatchSchema = createInsertSchema(invoiceBatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InvoiceBatch = typeof invoiceBatches.$inferSelect;
export type InsertInvoiceBatch = z.infer<typeof insertInvoiceBatchSchema>;

export const INVOICE_BATCH_LINE_STATUSES = [
  "included",
  "excluded",
  "blocked",
  "duplicate",
] as const;
export type InvoiceBatchLineStatus = (typeof INVOICE_BATCH_LINE_STATUSES)[number];

export const invoiceBatchItems = pgTable("invoice_batch_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => invoiceBatches.id, { onDelete: "cascade" }),
  invoiceReadinessSnapshotId: integer("invoice_readiness_snapshot_id")
    .references(() => invoiceReadinessSnapshots.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id"),
  patientScreeningId: integer("patient_screening_id"),
  procedureEventId: integer("procedure_event_id"),
  facilityId: text("facility_id"),
  testType: text("test_type").notNull(),
  patientName: text("patient_name"),
  dateOfService: text("date_of_service"),
  price: numeric("price", { precision: 12, scale: 2 }),
  revenueSplit: jsonb("revenue_split").notNull().default({}),
  lineStatus: text("line_status").notNull().default("included"),
  blockers: jsonb("blockers").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_batch_items_batch_id").on(table.batchId),
  index("idx_invoice_batch_items_status").on(table.lineStatus),
  index("idx_invoice_batch_items_execution_case_id").on(table.executionCaseId),
]);

export const insertInvoiceBatchItemSchema = createInsertSchema(invoiceBatchItems).omit({
  id: true,
  createdAt: true,
});
export type InvoiceBatchItem = typeof invoiceBatchItems.$inferSelect;
export type InsertInvoiceBatchItem = z.infer<typeof insertInvoiceBatchItemSchema>;
