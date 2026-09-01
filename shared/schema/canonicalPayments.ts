// Phase 2J — canonical payment ledger (migration 0056). APPEND-ONLY financial
// events (payment / refund / reversal / adjustment). Balances are DERIVED from the
// ledger, never a mutable stored truth. Reversals/refunds are NEW rows. NO
// clinic/Plexus revenue split, partner commission, or profit distribution.
// Nothing reads/writes this until FEATURE_CANONICAL_PAYMENTS is ON.
import {
  sql, pgTable, serial, text, varchar, integer, numeric, timestamp, index,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";

export const CANONICAL_PAYMENT_EVENT_TYPES = ["payment", "refund", "reversal", "adjustment"] as const;
export type CanonicalPaymentEventType = (typeof CANONICAL_PAYMENT_EVENT_TYPES)[number];
// Only sources the repository already represents — never invent a processor.
export const CANONICAL_PAYMENT_TYPES = ["patient", "payer", "manual", "processor_import", "remittance_import"] as const;
export type CanonicalPaymentType = (typeof CANONICAL_PAYMENT_TYPES)[number];
export const CANONICAL_PAYMENT_STATUSES = ["pending", "imported", "posted", "reversed", "failed"] as const;
export type CanonicalPaymentStatus = (typeof CANONICAL_PAYMENT_STATUSES)[number];
// Only these events count as collected toward a balance.
export const CANONICAL_PAYMENT_COLLECTED_EVENTS: readonly CanonicalPaymentEventType[] = ["payment"] as const;

export const canonicalPayments = pgTable("canonical_payments", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "no action" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  serviceType: text("service_type"),
  claimId: integer("claim_id"),
  invoiceId: integer("invoice_id"),
  eventType: text("event_type").notNull().default("payment"),
  paymentType: text("payment_type").notNull().default("manual"),
  // Never defaults to posted — an unverified insert is pending; a validated command
  // sets posted with exact source + actor provenance.
  status: text("status").notNull().default("pending"),
  currency: text("currency").notNull().default("USD"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  externalTransactionId: text("external_transaction_id"),
  commandFingerprint: text("command_fingerprint"),
  reversesPaymentId: integer("reverses_payment_id"),
  reason: text("reason"),
  receivedAt: timestamp("received_at"),
  postedAt: timestamp("posted_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  idempotencyKey: text("idempotency_key"),
  actorUserId: varchar("actor_user_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // NO updated_at — rows are immutable (append-only). Corrections are new events.
}, (table) => [
  index("idx_cp_clinic").on(table.clinicId),
  index("idx_cp_ancillary_case").on(table.ancillaryCaseId),
  index("idx_cp_claim").on(table.claimId),
  index("idx_cp_invoice").on(table.invoiceId),
  index("idx_cp_reverses").on(table.reversesPaymentId),
]);

export const insertCanonicalPaymentSchema = createInsertSchema(canonicalPayments).omit({ id: true, createdAt: true });
export type CanonicalPayment = typeof canonicalPayments.$inferSelect;
export type InsertCanonicalPayment = z.infer<typeof insertCanonicalPaymentSchema>;
