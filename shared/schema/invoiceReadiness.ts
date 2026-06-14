// invoice_readiness_snapshots — Phase 4 PR 4.2.
//
// Per-(case, testType) snapshot of the readiness engine's evaluation.
// Engine writes; UI reads. Re-evaluation upserts by
// (executionCaseId, serviceType).

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  uniqueIndex, numeric, createInsertSchema, z,
} from "./_common";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";
import { procedureEvents } from "./procedureEvents";
import { invoices } from "./invoices";

export const INVOICE_READINESS_STATUSES = [
  "not_ready",
  "blocked",
  "ready_to_invoice",
  "invoice_draft_created",
  "invoiced",
  "excluded",
] as const;
export type InvoiceReadinessStatus = (typeof INVOICE_READINESS_STATUSES)[number];

/** Canonical blocker codes used by the engine. UI groups on these. */
export const INVOICE_READINESS_BLOCKERS = [
  "missing_report",
  "missing_consent",
  "missing_screening",
  "missing_order_note",
  "missing_procedure_note",
  "physician_signature_pending",
  "billing_readiness_pending",
  "insurance_verification_pending",
  "procedure_not_complete",
  "cancelled",
  "no_show_not_billable",
  "missing_price",
  "missing_recipient",
  "already_invoiced",
  "duplicate_risk",
  "facility_policy_missing",
  "test_type_policy_missing",
] as const;
export type InvoiceReadinessBlocker = (typeof INVOICE_READINESS_BLOCKERS)[number];

export const invoiceReadinessSnapshots = pgTable("invoice_readiness_snapshots", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "cascade" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  readinessStatus: text("readiness_status").notNull().default("not_ready"),
  blockers: jsonb("blockers").notNull().default([]),
  priceSnapshot: jsonb("price_snapshot").notNull().default({}),
  policySnapshot: jsonb("policy_snapshot").notNull().default({}),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  evaluatedAt: timestamp("evaluated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_invoice_readiness_facility_id").on(table.facilityId),
  index("idx_invoice_readiness_service_type").on(table.serviceType),
  index("idx_invoice_readiness_status").on(table.readinessStatus),
  index("idx_invoice_readiness_execution_case_id").on(table.executionCaseId),
  index("idx_invoice_readiness_patient_screening_id").on(table.patientScreeningId),
  uniqueIndex("idx_invoice_readiness_case_service")
    .on(table.executionCaseId, table.serviceType),
]);

export const insertInvoiceReadinessSnapshotSchema = createInsertSchema(invoiceReadinessSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  evaluatedAt: true,
});

export type InvoiceReadinessSnapshot = typeof invoiceReadinessSnapshots.$inferSelect;
export type InsertInvoiceReadinessSnapshot = z.infer<typeof insertInvoiceReadinessSnapshotSchema>;
