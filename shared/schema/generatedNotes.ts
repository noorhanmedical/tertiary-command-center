import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, boolean, index, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";

export const NOTE_TYPES = ["order_note", "post_procedure_note"] as const;
export type NoteType = typeof NOTE_TYPES[number];

export const NOTE_GENERATION_STATUSES = [
  "pending",
  "generating",
  "generated",
  "failed",
  "approved",
] as const;
export type NoteGenerationStatus = typeof NOTE_GENERATION_STATUSES[number];

export const procedureNotes = pgTable("procedure_notes", {
  id: serial("id").primaryKey(),
  executionCaseId: integer("execution_case_id").references(() => patientExecutionCases.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  procedureEventId: integer("procedure_event_id").references(() => procedureEvents.id, { onDelete: "set null" }),
  serviceType: text("service_type").notNull(),
  noteType: text("note_type").notNull(),
  generationStatus: text("generation_status").notNull().default("pending"),
  generatedText: text("generated_text"),
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  sourceData: jsonb("source_data").notNull().default({}),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pn_execution_case_id").on(table.executionCaseId),
  index("idx_pn_patient_screening_id").on(table.patientScreeningId),
  index("idx_pn_procedure_event_id").on(table.procedureEventId),
  index("idx_pn_service_type").on(table.serviceType),
  index("idx_pn_note_type").on(table.noteType),
  index("idx_pn_generation_status").on(table.generationStatus),
  uniqueIndex("idx_pn_unique_note").on(table.patientScreeningId, table.serviceType, table.noteType),
]);

export const insertProcedureNoteSchema = createInsertSchema(procedureNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProcedureNote = typeof procedureNotes.$inferSelect;
export type InsertProcedureNote = z.infer<typeof insertProcedureNoteSchema>;
