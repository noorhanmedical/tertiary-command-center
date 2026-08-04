// Phase 2J — canonical payment ALLOCATIONS (migration 0056). APPEND-ONLY. A
// payment RECEIPT (canonical_payments) records money received; an ALLOCATION
// applies part/all of a receipt to ONE exact target (a claim or an invoice) in the
// same clinic/case/service/currency. One receipt may have many allocation rows
// (split across targets); the unapplied remainder is explicit (receipt amount minus
// the sum of its allocations). Balances derive from these rows — never a stored
// mutable truth. NO revenue-share/commission/profit-split target ever exists.
import {
  sql, pgTable, serial, text, varchar, integer, numeric, timestamp, index, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";
import { canonicalPayments } from "./canonicalPayments";

export const CANONICAL_ALLOCATION_TARGET_TYPES = ["claim", "invoice"] as const;
export type CanonicalAllocationTargetType = (typeof CANONICAL_ALLOCATION_TARGET_TYPES)[number];

export const canonicalPaymentAllocations = pgTable("canonical_payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => canonicalPayments.id, { onDelete: "no action" }),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "no action" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  serviceType: text("service_type"),
  targetType: text("target_type").notNull(),          // claim | invoice
  targetId: integer("target_id").notNull(),
  currency: text("currency").notNull().default("USD"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  isOverpayment: integer("is_overpayment").notNull().default(0), // 0/1 — explicit overpayment flag
  reason: text("reason"),
  idempotencyKey: text("idempotency_key"),
  actorUserId: varchar("actor_user_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // NO updated_at — append-only. Corrections are new (possibly negating) rows.
}, (table) => [
  index("idx_cpa_payment").on(table.paymentId),
  index("idx_cpa_clinic").on(table.clinicId),
  index("idx_cpa_target").on(table.targetType, table.targetId),
  uniqueIndex("uq_cpa_idempotency").on(table.clinicId, table.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
]);

export const insertCanonicalPaymentAllocationSchema = createInsertSchema(canonicalPaymentAllocations).omit({ id: true, createdAt: true });
export type CanonicalPaymentAllocation = typeof canonicalPaymentAllocations.$inferSelect;
export type InsertCanonicalPaymentAllocation = z.infer<typeof insertCanonicalPaymentAllocationSchema>;
