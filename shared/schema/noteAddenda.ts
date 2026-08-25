/**
 * Phase 5 — Note Addenda.
 *
 * Supports traceable addenda attached to signed clinical documents
 * (e.g., Screening Form findings appended to a signed Order Note)
 * without mutating the signed parent document.
 *
 * The parent_note_id references procedure_notes (the canonical
 * document lifecycle table that holds both order_notes and
 * post_procedure_notes via the note_type column).
 */

import {
  sql,
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  boolean,
  createInsertSchema,
  z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";
import { procedureNotes } from "./generatedNotes";
import { patientScreenings } from "./screening";

// ─── Enums ────────────────────────────────────────────────────────────────

export const ADDENDUM_TYPES = [
  "screening_addendum",
  "clinical_update",
  "correction",
  "supplemental_evidence",
  "other",
] as const;
export type AddendumType = (typeof ADDENDUM_TYPES)[number];

export const ADDENDUM_SOURCE_TYPES = [
  "screening_form",
  "encounter",
  "lab",
  "imaging",
  "manual",
  "ai_generated",
  "other",
] as const;
export type AddendumSourceType = (typeof ADDENDUM_SOURCE_TYPES)[number];

// ─── Table ────────────────────────────────────────────────────────────────

export const noteAddenda = pgTable("note_addenda", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  parentNoteId: integer("parent_note_id").notNull().references(() => procedureNotes.id, { onDelete: "cascade" }),
  ancillaryCaseId: integer("ancillary_case_id"),
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),

  // Content
  addendumType: text("addendum_type").notNull().default("screening_addendum"),
  title: text("title"),
  content: text("content").notNull(),
  structuredData: jsonb("structured_data").default({}),

  // Source provenance
  sourceType: text("source_type"),
  sourceRecordId: text("source_record_id"),

  // Authorship
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),

  // Signature (optional — some addenda may require clinician sign-off)
  requiresSignature: boolean("requires_signature").notNull().default(false),
  signatureStatus: text("signature_status"),
  signedAt: timestamp("signed_at"),
  signedByUserId: varchar("signed_by_user_id").references(() => users.id, { onDelete: "set null" }),

  // Lifecycle
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_na_parent_note").on(table.parentNoteId),
  index("idx_na_ancillary_case").on(table.ancillaryCaseId),
  index("idx_na_screening").on(table.patientScreeningId),
  index("idx_na_addendum_type").on(table.addendumType),
  index("idx_na_signature_status").on(table.signatureStatus),
]);

// ─── Schemas / Types ──────────────────────────────────────────────────────

export const insertNoteAddendumSchema = createInsertSchema(noteAddenda).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  signedAt: true,
  signedByUserId: true,
});

export type NoteAddendum = typeof noteAddenda.$inferSelect;
export type InsertNoteAddendum = z.infer<typeof insertNoteAddendumSchema>;
