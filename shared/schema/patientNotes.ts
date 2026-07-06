// patient_notes — Phase 2 PR 2.6
//
// Canonical operator notes. Distinct from generated_notes (AI-
// generated clinical document drafts).
//
// A note is always linked to a patient (patientScreeningId) and
// optionally to an execution case. The author is the session user
// who wrote the row. Notes are append-only at runtime (no edits
// in PR 2.6); deactivation is via `archivedAt`.
//
// Note types:
//   - quick_note         — operator note from the QuickNoteTool
//   - call_note          — note attached during call disposition
//   - acs_note           — ACS workflow operator note
//   - admin_note         — admin annotation
//   - system_note        — service-generated note (rare; auditable)

import {
  sql, pgTable, serial, text, varchar, integer, timestamp, boolean,
  jsonb, index, createInsertSchema, z,
} from "./_common";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";
import { users } from "./users";
import { clinics } from "./clinics";

export const PATIENT_NOTE_TYPES = [
  "quick_note",
  "call_note",
  "acs_note",
  "admin_note",
  "system_note",
] as const;
export type PatientNoteType = (typeof PATIENT_NOTE_TYPES)[number];

export const patientNotes = pgTable("patient_notes", {
  id: serial("id").primaryKey(),
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  patientScreeningId: integer("patient_screening_id")
    .notNull()
    .references(() => patientScreenings.id, { onDelete: "cascade" }),
  executionCaseId: integer("execution_case_id").references(
    () => patientExecutionCases.id,
    { onDelete: "set null" },
  ),
  noteType: text("note_type").notNull().default("quick_note"),
  body: text("body").notNull(),
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),
  isInternal: boolean("is_internal").notNull().default(true),
  metadata: jsonb("metadata").notNull().default({}),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_patient_notes_patient_screening_id").on(table.patientScreeningId),
  index("idx_patient_notes_execution_case_id").on(table.executionCaseId),
  index("idx_patient_notes_author_user_id").on(table.authorUserId),
  index("idx_patient_notes_note_type").on(table.noteType),
  index("idx_patient_notes_created_at").on(table.createdAt),
]);

export const insertPatientNoteSchema = createInsertSchema(patientNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PatientNote = typeof patientNotes.$inferSelect;
export type InsertPatientNote = z.infer<typeof insertPatientNoteSchema>;
