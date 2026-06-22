import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, boolean, index, uniqueIndex,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { users } from "./users";

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

// Physician Owner Portal signature state machine. These columns give the
// dormant signingService.ts state machine real columns to write into so the
// signing flow lives in the same table as note generation/billing readiness
// (no parallel store).
export const SIGNATURE_STATUSES = [
  "needs_signature",
  "ready_to_sign",
  "signed",
  "returned_for_correction",
] as const;
export type SignatureStatus = typeof SIGNATURE_STATUSES[number];

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
  // Physician Owner Portal signature workflow (nullable — legacy rows stay null).
  signatureStatus: text("signature_status"),
  signedAt: timestamp("signed_at"),
  signedByUserId: varchar("signed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  returnReason: text("return_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_pn_execution_case_id").on(table.executionCaseId),
  index("idx_pn_patient_screening_id").on(table.patientScreeningId),
  index("idx_pn_procedure_event_id").on(table.procedureEventId),
  index("idx_pn_service_type").on(table.serviceType),
  index("idx_pn_note_type").on(table.noteType),
  index("idx_pn_generation_status").on(table.generationStatus),
  index("idx_pn_signature_status").on(table.signatureStatus),
  uniqueIndex("idx_pn_unique_note").on(table.patientScreeningId, table.serviceType, table.noteType),
]);

export const insertProcedureNoteSchema = createInsertSchema(procedureNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProcedureNote = typeof procedureNotes.$inferSelect;
export type InsertProcedureNote = z.infer<typeof insertProcedureNoteSchema>;
