// Phase 2J — canonical financial TRANSITION/AUDIT log (migration 0056). APPEND-ONLY.
// Every claim/invoice/payment lifecycle command writes ONE row here inside its own
// transaction: exact entity + clinic/case/service, from→to status, actor, server
// timestamp, reason, source type/reference, and the command idempotency key. This
// is the durable provenance for advancing a financial state; a status such as
// submitted/issued/delivered/paid/refunded is never advanced without a matching
// row. PHI-free (codes/ids only — never note text or document bytes).
import {
  sql, pgTable, serial, text, varchar, integer, timestamp, index, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";

export const CANONICAL_FINANCIAL_ENTITY_TYPES = ["claim", "invoice", "payment", "allocation"] as const;
export type CanonicalFinancialEntityType = (typeof CANONICAL_FINANCIAL_ENTITY_TYPES)[number];

export const canonicalFinancialTransitions = pgTable("canonical_financial_transitions", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),          // claim | invoice | payment | allocation
  entityId: integer("entity_id").notNull(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "no action" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  serviceType: text("service_type"),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorUserId: varchar("actor_user_id"),
  actorRole: text("actor_role"),
  reason: text("reason"),
  sourceType: text("source_type"),
  sourceReference: text("source_reference"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_cft_entity").on(table.entityType, table.entityId),
  index("idx_cft_clinic").on(table.clinicId),
  uniqueIndex("uq_cft_idempotency").on(table.entityType, table.clinicId, table.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
]);

export const insertCanonicalFinancialTransitionSchema = createInsertSchema(canonicalFinancialTransitions).omit({ id: true, createdAt: true });
export type CanonicalFinancialTransition = typeof canonicalFinancialTransitions.$inferSelect;
export type InsertCanonicalFinancialTransition = z.infer<typeof insertCanonicalFinancialTransitionSchema>;
