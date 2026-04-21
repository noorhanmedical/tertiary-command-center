import { sql, pgTable, serial, text, integer, timestamp, index, boolean, createInsertSchema, z } from "./_common";

export const OUTBOX_KINDS = [
  "drive_file",
  "sheet_billing",
  "sheet_patients",
] as const;
export type OutboxKind = typeof OUTBOX_KINDS[number];

export const OUTBOX_STATUSES = ["pending", "uploading", "completed", "failed"] as const;
export type OutboxStatus = typeof OUTBOX_STATUSES[number];

export const outboxItems = pgTable("outbox_items", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  blobId: integer("blob_id"),
  facility: text("facility"),
  patientName: text("patient_name"),
  ancillaryType: text("ancillary_type"),
  docKind: text("doc_kind"),
  targetFolderId: text("target_folder_id"),
  targetSheetId: text("target_sheet_id"),
  filename: text("filename"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  errorText: text("error_text"),
  resultId: text("result_id"),
  resultUrl: text("result_url"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_outbox_items_status").on(table.status),
  index("idx_outbox_items_kind").on(table.kind),
  index("idx_outbox_items_is_test").on(table.isTest),
]);

export const insertOutboxItemSchema = createInsertSchema(outboxItems).omit({
  id: true,
  createdAt: true,
  lastAttemptAt: true,
  completedAt: true,
});

export type OutboxItem = typeof outboxItems.$inferSelect;
export type InsertOutboxItem = z.infer<typeof insertOutboxItemSchema>;
