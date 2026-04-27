import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";

export const BILLING_READINESS_STATUSES = [
  "not_ready",
  "missing_requirements",
  "ready_to_generate",
  "billing_document_generated",
  "sent_to_billing",
] as const;
export type BillingReadinessStatus = typeof BILLING_READINESS_STATUSES[number];

export const billingReadinessChecks = pgTable("billing_readiness_checks", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  readinessStatus: text("readiness_status").notNull().default("not_ready"),
  missingRequirements: jsonb("missing_requirements").notNull().default([]),
  readyAt: timestamp("ready_at"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_brc_execution_case_id").on(table.executionCaseId),
  index("idx_brc_patient_screening_id").on(table.patientScreeningId),
  index("idx_brc_procedure_event_id").on(table.procedureEventId),
  index("idx_brc_service_type").on(table.serviceType),
  index("idx_brc_readiness_status").on(table.readinessStatus),
]);

export const insertBillingReadinessCheckSchema = createInsertSchema(billingReadinessChecks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BillingReadinessCheck = typeof billingReadinessChecks.$inferSelect;
export type InsertBillingReadinessCheck = z.infer<typeof insertBillingReadinessCheckSchema>;
