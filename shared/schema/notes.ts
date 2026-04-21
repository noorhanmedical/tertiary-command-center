import { sql, pgTable, serial, text, integer, timestamp, jsonb, index, boolean, createInsertSchema, z } from "./_common";
import { patientScreenings, screeningBatches } from "./screening";

export const generatedNotes = pgTable("generated_notes", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => patientScreenings.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => screeningBatches.id, { onDelete: "cascade" }),
  facility: text("facility"),
  scheduleDate: text("schedule_date"),
  patientName: text("patient_name").notNull(),
  service: text("service").notNull(),
  docKind: text("doc_kind").notNull(),
  title: text("title").notNull(),
  sections: jsonb("sections").notNull(),
  generatedAt: timestamp("generated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  driveFileId: text("drive_file_id"),
  driveWebViewLink: text("drive_web_view_link"),
  isTest: boolean("is_test").notNull().default(false),
}, (table) => [
  index("idx_generated_notes_patient_id").on(table.patientId),
  index("idx_generated_notes_batch_id").on(table.batchId),
]);

export const insertGeneratedNoteSchema = createInsertSchema(generatedNotes).omit({
  id: true,
  generatedAt: true,
});

export type GeneratedNote = typeof generatedNotes.$inferSelect;
export type InsertGeneratedNote = z.infer<typeof insertGeneratedNoteSchema>;
