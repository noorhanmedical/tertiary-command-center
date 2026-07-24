import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb, boolean, index,
  createInsertSchema, z,
} from "./_common";
import { patientExecutionCases } from "./executionCase";
import { patientScreenings } from "./screening";
import { procedureEvents } from "./procedureEvents";
import { users } from "./users";
import { clinics } from "./clinics";

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
  // Multi-tenancy: nullable during backfill; filter enforced in repository layer.
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
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
  // ── Phase 2E-A2 canonical Order Note identity (migration 0053) ──
  // Case-scoped identity + evidence + supersession. FKs are declared in
  // the migration only (a reverse import of patientAncillaryCases /
  // globalScheduleEvents / adminReviewEvents here would risk a schema
  // import cycle — same pattern as patientAncillaryCases' own screening /
  // execution-case links). All nullable so legacy rows stay valid until
  // the dry-run-first backfill deterministically links them.
  ancillaryCaseId: integer("ancillary_case_id"),
  globalPlexusPatientId: integer("global_plexus_patient_id"),
  patientClinicMembershipId: integer("patient_clinic_membership_id"),
  qualifyingGlobalScheduleEventId: integer("qualifying_global_schedule_event_id"),
  adminReviewEventId: integer("admin_review_event_id"),
  // Timeless clinical date, distinct from the server-owned createdAt.
  effectiveClinicalDate: timestamp("effective_clinical_date"),
  // Correction/version foundation only (no correction UI in this phase).
  supersedesNoteId: integer("supersedes_note_id"),
  supersededAt: timestamp("superseded_at"),
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
  index("idx_pn_ancillary_case").on(table.ancillaryCaseId),
  index("idx_pn_supersedes_note").on(table.supersedesNoteId),
  index("idx_pn_superseded_at").on(table.supersededAt),
  // NOTE: the pre-2E `idx_pn_unique_note` global unique
  // (patient_screening_id, service_type, note_type) is REPLACED in
  // migration 0053 by three partial unique indexes that Drizzle's table
  // API cannot model (partial WHERE clauses):
  //   uq_pn_order_note_active_case  (ancillary_case_id, note_type)  — canonical current
  //   uq_pn_order_note_legacy       (screening, service, note_type) — legacy unlinked
  //   uq_pn_post_procedure_note     (screening, service, note_type) — Phase 2F preserved
]);

// Client-input insert validation. Server-owned canonical Order Note
// identity/evidence/supersession fields are NOT accepted from unrestricted
// client input — the canonical Order Note service (and the authorized
// signing workflow) own them via direct writes. signedAt/signedByUserId
// remain settable here only for the session-authenticated signing update
// path (updateGeneratedNote), never from a raw client body.
export const insertProcedureNoteSchema = createInsertSchema(procedureNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  ancillaryCaseId: true,
  globalPlexusPatientId: true,
  patientClinicMembershipId: true,
  qualifyingGlobalScheduleEventId: true,
  adminReviewEventId: true,
  effectiveClinicalDate: true,
  supersedesNoteId: true,
  supersededAt: true,
});

export type ProcedureNote = typeof procedureNotes.$inferSelect;
export type InsertProcedureNote = z.infer<typeof insertProcedureNoteSchema>;
