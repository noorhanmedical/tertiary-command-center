import {
  sql, pgTable, serial, text, varchar, integer, timestamp, index, uniqueIndex, boolean,
  createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientScreenings } from "./screening";

export const uploadedDocuments = pgTable("uploaded_documents", {
  id: serial("id").primaryKey(),
  facility: text("facility").notNull(),
  patientName: text("patient_name").notNull(),
  ancillaryType: text("ancillary_type").notNull(),
  docType: text("doc_type").notNull(),
  driveFileId: text("drive_file_id"),
  driveWebViewLink: text("drive_web_view_link"),
  uploadedAt: timestamp("uploaded_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  isTest: boolean("is_test").notNull().default(false),
});

export const insertUploadedDocumentSchema = createInsertSchema(uploadedDocuments).omit({
  id: true,
  uploadedAt: true,
});

export type UploadedDocument = typeof uploadedDocuments.$inferSelect;
export type InsertUploadedDocument = z.infer<typeof insertUploadedDocumentSchema>;

export const documentBlobs = pgTable("document_blobs", {
  id: serial("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: integer("owner_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  sha256: text("sha256").notNull(),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_document_blobs_owner").on(table.ownerType, table.ownerId),
  index("idx_document_blobs_sha256").on(table.sha256),
]);

export const insertDocumentBlobSchema = createInsertSchema(documentBlobs).omit({
  id: true,
  createdAt: true,
});

export type DocumentBlob = typeof documentBlobs.$inferSelect;
export type InsertDocumentBlob = z.infer<typeof insertDocumentBlobSchema>;

export const marketingMaterials = pgTable("marketing_materials", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  sha256: text("sha256").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_marketing_materials_created_at").on(table.createdAt),
  index("idx_marketing_materials_sha256").on(table.sha256),
]);

export const insertMarketingMaterialSchema = createInsertSchema(marketingMaterials).omit({
  id: true,
  createdAt: true,
}).extend({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(1000).optional().default(""),
});

export type MarketingMaterial = typeof marketingMaterials.$inferSelect;
export type InsertMarketingMaterial = z.infer<typeof insertMarketingMaterialSchema>;

export const DOCUMENT_KINDS = [
  "informed_consent", "screening_form", "marketing", "training",
  "reference", "clinician_pdf", "report", "other",
] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];

export const DOCUMENT_SIGNATURE_REQUIREMENTS = ["none", "patient", "clinician", "both"] as const;
export type DocumentSignatureRequirement = typeof DOCUMENT_SIGNATURE_REQUIREMENTS[number];

export const DOCUMENT_SURFACES = [
  "tech_consent_picker", "scheduler_resources", "patient_chart",
  "liaison_drawer", "marketing_hub", "training_library", "internal_reference",
] as const;
export type DocumentSurface = typeof DOCUMENT_SURFACES[number];

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind").notNull(),
  signatureRequirement: text("signature_requirement").notNull().default("none"),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  version: integer("version").notNull().default(1),
  supersededByDocumentId: integer("superseded_by_document_id"),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  facility: text("facility"),
  sourceNotes: text("source_notes"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_documents_kind").on(table.kind),
  index("idx_documents_created_at").on(table.createdAt),
  index("idx_documents_superseded").on(table.supersededByDocumentId),
  index("idx_documents_patient_screening_id").on(table.patientScreeningId),
  index("idx_documents_deleted_at").on(table.deletedAt),
]);

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  version: true,
  supersededByDocumentId: true,
  deletedAt: true,
}).extend({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(1000).optional().default(""),
  kind: z.enum(DOCUMENT_KINDS),
  signatureRequirement: z.enum(DOCUMENT_SIGNATURE_REQUIREMENTS).optional(),
  patientScreeningId: z.number().int().optional().nullable(),
  facility: z.string().max(200).optional().nullable(),
  sourceNotes: z.string().max(1000).optional().nullable(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export const documentSurfaceAssignments = pgTable("document_surface_assignments", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  surface: text("surface").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("uq_document_surface_assignments_doc_surface").on(table.documentId, table.surface),
  index("idx_document_surface_assignments_surface").on(table.surface),
]);

export const insertDocumentSurfaceAssignmentSchema = createInsertSchema(documentSurfaceAssignments).omit({
  id: true,
  createdAt: true,
}).extend({
  surface: z.enum(DOCUMENT_SURFACES),
});

export type DocumentSurfaceAssignment = typeof documentSurfaceAssignments.$inferSelect;
export type InsertDocumentSurfaceAssignment = z.infer<typeof insertDocumentSurfaceAssignmentSchema>;
