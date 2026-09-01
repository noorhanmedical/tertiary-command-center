/**
 * Phase 10 — Plexus Bank Events.
 *
 * Append-only financial event log for operational reconciliation.
 * NOT a double-entry accounting system. Every event is traceable to
 * patient → service episode → claim → invoice → payment.
 *
 * Financial history is append-safe: corrections are represented as
 * new events (e.g., a recoupment is a negative amount event), never
 * by rewriting historical records.
 */

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";
import { patientScreenings } from "./screening";
import { invoices } from "./invoices";
import { invoicePayments } from "./invoices";
import { billingRecords } from "./billing";

// ─── Enums ────────────────────────────────────────────────────────────────

export const BANK_EVENT_TYPES = [
  "payer_claim_payment",
  "patient_payment",
  "facility_obligation",
  "plexus_allocation",
  "facility_payment",
  "vendor_payment",
  "adjustment",
  "refund",
  "write_off",
  "recoupment",
  "transfer",
] as const;
export type BankEventType = (typeof BANK_EVENT_TYPES)[number];

export const COUNTERPARTY_TYPES = [
  "payer",
  "patient",
  "facility",
  "vendor",
  "plexus",
] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

export const RECONCILIATION_STATUSES = [
  "pending",
  "reconciled",
  "disputed",
  "unresolved",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

// ─── Table ────────────────────────────────────────────────────────────────

export const plexusBankEvents = pgTable("plexus_bank_events", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  facilityId: text("facility_id"),

  // Event classification
  eventType: text("event_type").notNull(),
  eventSubtype: text("event_subtype"),

  // Financial amount (positive = credit/receipt, negative = debit/payment-out)
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),

  // Lineage
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  serviceType: text("service_type"),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  invoicePaymentId: integer("invoice_payment_id").references(() => invoicePayments.id, { onDelete: "set null" }),
  billingRecordId: integer("billing_record_id").references(() => billingRecords.id, { onDelete: "set null" }),

  // Counterparty
  counterpartyType: text("counterparty_type"),
  counterpartyName: text("counterparty_name"),

  // Reconciliation
  reconciliationStatus: text("reconciliation_status").notNull().default("pending"),
  reconciledAt: timestamp("reconciled_at"),
  reconciledByUserId: varchar("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),

  // Reference / metadata
  reference: text("reference"),
  description: text("description"),
  metadata: jsonb("metadata").default({}),

  // Transaction date (business date)
  transactionDate: text("transaction_date").notNull(),

  // Lifecycle (append-only: no updatedAt)
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  index("idx_pbe_clinic").on(table.clinicId),
  index("idx_pbe_facility").on(table.facilityId),
  index("idx_pbe_event_type").on(table.eventType),
  index("idx_pbe_ancillary_case").on(table.ancillaryCaseId),
  index("idx_pbe_invoice").on(table.invoiceId),
  index("idx_pbe_reconciliation").on(table.reconciliationStatus),
  index("idx_pbe_transaction_date").on(table.transactionDate),
  index("idx_pbe_counterparty").on(table.counterpartyType),
]);

// ─── Schemas / Types ──────────────────────────────────────────────────────

export const insertPlexusBankEventSchema = createInsertSchema(plexusBankEvents).omit({
  id: true,
  createdAt: true,
  reconciledAt: true,
  reconciledByUserId: true,
});

export type PlexusBankEvent = typeof plexusBankEvents.$inferSelect;
export type InsertPlexusBankEvent = z.infer<typeof insertPlexusBankEventSchema>;
