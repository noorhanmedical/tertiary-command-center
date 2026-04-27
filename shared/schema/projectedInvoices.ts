import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { invoiceLineItems } from "./invoices";

export const PROJECTED_STATUSES = [
  "projected_open",
  "projected_sent",
  "converted_to_real_invoice",
  "variance_review",
  "projected_closed",
] as const;
export type ProjectedStatus = typeof PROJECTED_STATUSES[number];

export const projectedInvoiceRows = pgTable("projected_invoice_rows", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  patientName: text("patient_name"),
  patientInitials: text("patient_initials"),
  patientDob: text("patient_dob"),
  facilityId: text("facility_id"),
  serviceType: text("service_type").notNull(),
  dos: text("dos"),
  projectedFullAmount: text("projected_full_amount").notNull(),
  projectedOurPortionPercentage: text("projected_our_portion_percentage").notNull().default("50"),
  projectedOurPortionAmount: text("projected_our_portion_amount").notNull(),
  projectedStatus: text("projected_status").notNull().default("projected_open"),
  realInvoiceLineItemId: integer("real_invoice_line_item_id").references(() => invoiceLineItems.id, { onDelete: "set null" }),
  varianceAmount: text("variance_amount"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pir_execution_case_id").on(table.executionCaseId),
  index("idx_pir_patient_screening_id").on(table.patientScreeningId),
  index("idx_pir_procedure_event_id").on(table.procedureEventId),
  index("idx_pir_facility_id").on(table.facilityId),
  index("idx_pir_service_type").on(table.serviceType),
  index("idx_pir_projected_status").on(table.projectedStatus),
  index("idx_pir_real_invoice_line_item_id").on(table.realInvoiceLineItemId),
]);

export const insertProjectedInvoiceRowSchema = createInsertSchema(projectedInvoiceRows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProjectedInvoiceRow = typeof projectedInvoiceRows.$inferSelect;
export type InsertProjectedInvoiceRow = z.infer<typeof insertProjectedInvoiceRowSchema>;
