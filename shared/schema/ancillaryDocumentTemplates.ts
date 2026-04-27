import {
  sql, pgTable, serial, text, integer, boolean, timestamp, jsonb, index,
  createInsertSchema, z,
} from "./_common";
import { documents } from "./documents";

export const ANCILLARY_DOCUMENT_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
  "billing_document",
  "patient_brochure",
  "prep_instructions",
  "clinician_material",
  "marketing_material",
] as const;
export type AncillaryDocumentType = typeof ANCILLARY_DOCUMENT_TYPES[number];

export const ANCILLARY_DOCUMENT_APPROVAL_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "retired",
] as const;
export type AncillaryDocumentApprovalStatus = typeof ANCILLARY_DOCUMENT_APPROVAL_STATUSES[number];

export const ancillaryDocumentTemplates = pgTable("ancillary_document_templates", {
  id: serial("id").primaryKey(),
  serviceType: text("service_type").notNull(),
  documentType: text("document_type").notNull(),
  documentId: integer("document_id").references(() => documents.id, { onDelete: "set null" }),
  facilityId: text("facility_id"),
  required: boolean("required").notNull().default(true),
  active: boolean("active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  approvalStatus: text("approval_status").notNull().default("draft"),
  effectiveDate: text("effective_date"),
  expirationDate: text("expiration_date"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_adt_service_type").on(table.serviceType),
  index("idx_adt_document_type").on(table.documentType),
  index("idx_adt_document_id").on(table.documentId),
  index("idx_adt_facility_id").on(table.facilityId),
  index("idx_adt_active").on(table.active),
  index("idx_adt_approval_status").on(table.approvalStatus),
]);

export const insertAncillaryDocumentTemplateSchema = createInsertSchema(ancillaryDocumentTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AncillaryDocumentTemplate = typeof ancillaryDocumentTemplates.$inferSelect;
export type InsertAncillaryDocumentTemplate = z.infer<typeof insertAncillaryDocumentTemplateSchema>;
