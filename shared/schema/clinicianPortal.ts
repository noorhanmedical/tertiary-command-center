import {
  sql, pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex, index,
} from "./_common";

// ─── Clinician Portal persistence ───────────────────────────────────────────
// The Clinician Portal (Orders & Notes, Plexus Engagement) is a demo command
// center seeded from shared mock data (client/src/components/physician/
// mockData.ts). These tables persist the *actions* a clinician takes on that
// data — signing/amending notes, recording call outcomes, adding studies to
// the live schedule — so they survive a refresh. Each row is an overlay keyed
// by the mock record id; the immutable audit trail itself lives in audit_log
// (entityType "clinician_portal_note" / "clinician_portal_call").

// ─── Note action overlay (sign / send-back / amend / draft) ─────────────────
export const clinicianPortalNoteStates = pgTable("clinician_portal_note_states", {
  id: serial("id").primaryKey(),
  noteId: text("note_id").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  soap: jsonb("soap").$type<{
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  } | null>(),
  signedByName: text("signed_by_name"),
  signedAt: timestamp("signed_at"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  uniqueIndex("uq_cp_note_states_note").on(t.noteId),
]);

export type ClinicianPortalNoteState = typeof clinicianPortalNoteStates.$inferSelect;

// ─── Call outcome overlay ───────────────────────────────────────────────────
export const clinicianPortalCallStates = pgTable("clinician_portal_call_states", {
  id: serial("id").primaryKey(),
  callId: text("call_id").notNull(),
  status: text("status").notNull(),
  lastOutcome: text("last_outcome"),
  // Newly recorded history entries only — merged on top of the seed mock
  // history in the UI so we never have to persist the demo baseline.
  history: jsonb("history").$type<{ label: string; outcome: string; date: string }[]>()
    .notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  uniqueIndex("uq_cp_call_states_call").on(t.callId),
]);

export type ClinicianPortalCallState = typeof clinicianPortalCallStates.$inferSelect;

// ─── Schedule additions (patients booked from a call) ───────────────────────
export const clinicianPortalScheduleItems = pgTable("clinician_portal_schedule_items", {
  id: serial("id").primaryKey(),
  // patientId holds the aggregator MRN (the live portal keys patients by mrn,
  // not a numeric id). patientName is denormalized so the Live Schedule table
  // can render the row without a second lookup.
  patientId: text("patient_id").notNull(),
  patientName: text("patient_name").notNull().default(""),
  service: text("service").notNull(),
  time: text("time").notNull(),
  technician: text("technician").notNull(),
  status: text("status").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [
  uniqueIndex("uq_cp_schedule_patient_service").on(t.patientId, t.service),
  index("idx_cp_schedule_created").on(t.createdAt),
]);

export type ClinicianPortalScheduleItem = typeof clinicianPortalScheduleItems.$inferSelect;
