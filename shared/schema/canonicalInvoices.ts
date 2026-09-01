// Phase 2J — canonical invoices (migration 0056). An ancillary-case, evidence-
// versioned invoice DERIVED from a canonical claim — DISTINCT from the Phase 4
// operational (execution-case/facility-batch) invoice desk, which 2J never reads
// or rewrites. Nothing reads/writes this until FEATURE_CANONICAL_INVOICES is ON.
import {
  sql, pgTable, serial, text, varchar, integer, numeric, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { clinics } from "./clinics";

export const CANONICAL_INVOICE_STATUSES = [
  "draft", "approved", "issued", "delivered", "partially_paid", "paid",
  "voided", "superseded", "delivery_failed",
] as const;
export type CanonicalInvoiceStatus = (typeof CANONICAL_INVOICE_STATUSES)[number];
// Never merge distinct invoice meanings.
export const CANONICAL_INVOICE_TYPES = ["patient", "payer", "clinic"] as const;
export type CanonicalInvoiceType = (typeof CANONICAL_INVOICE_TYPES)[number];
export const CANONICAL_INVOICE_RECIPIENT_TYPES = ["patient_membership", "payer", "clinic"] as const;
export type CanonicalInvoiceRecipientType = (typeof CANONICAL_INVOICE_RECIPIENT_TYPES)[number];

export const canonicalInvoices = pgTable("canonical_invoices", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id, { onDelete: "no action" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  globalPlexusPatientId: integer("global_plexus_patient_id"),
  patientClinicMembershipId: integer("patient_clinic_membership_id"),
  serviceType: text("service_type").notNull(),
  claimId: integer("claim_id"),
  billingDocumentId: integer("billing_document_id"),
  billingReadinessCheckId: integer("billing_readiness_check_id"),
  evidenceFingerprint: text("evidence_fingerprint"),
  invoiceType: text("invoice_type").notNull().default("patient"),
  recipientType: text("recipient_type"),
  recipientId: text("recipient_id"),
  invoiceNumber: text("invoice_number"),
  canonicalStatus: text("canonical_status").notNull().default("draft"),
  currency: text("currency").notNull().default("USD"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }),
  lineItems: jsonb("line_items").notNull().default([]),
  amountSource: text("amount_source"),
  supersedesInvoiceId: integer("supersedes_invoice_id"),
  supersededAt: timestamp("superseded_at"),
  issuedAt: timestamp("issued_at"),
  deliveredAt: timestamp("delivered_at"),
  deliveryEventReference: text("delivery_event_reference"),
  warnings: jsonb("warnings").notNull().default([]),
  idempotencyKey: text("idempotency_key"),
  actorUserId: varchar("actor_user_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_ci_clinic").on(table.clinicId),
  index("idx_ci_ancillary_case").on(table.ancillaryCaseId),
  index("idx_ci_claim").on(table.claimId),
  index("idx_ci_status").on(table.canonicalStatus),
]);

export const insertCanonicalInvoiceSchema = createInsertSchema(canonicalInvoices).omit({ id: true, createdAt: true, updatedAt: true });
export type CanonicalInvoice = typeof canonicalInvoices.$inferSelect;
export type InsertCanonicalInvoice = z.infer<typeof insertCanonicalInvoiceSchema>;
