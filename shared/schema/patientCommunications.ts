// Canonical patient_communications table.
//
// One unified table for every team-member touch on a patient that
// isn't already captured elsewhere as a dedicated domain row:
//   - call (mirrors outreach_calls; the call row is the system of
//     record for outreach metrics, this row is the read-model entry
//     for the patient timeline)
//   - sms / marketing_sms (no SMS backend yet — these are log-only)
//   - email / marketing_email (mirrors actual email send results)
//   - internal_note / system_note (free-form audit notes)
//
// This table is intentionally append-only from the UI; updates flow
// through patient_journey_events when a status changes. Soft delete
// is not modeled here — a communication that was logged in error can
// be superseded by an internal_note.

import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  boolean,
  sql,
  createInsertSchema,
  z,
} from "./_common";
import { patientScreenings } from "./screening";
import { patientExecutionCases } from "./executionCase";
import { users } from "./users";

export const PATIENT_COMMUNICATION_TYPES = [
  "call",
  "sms",
  "email",
  "marketing_email",
  "marketing_sms",
  "internal_note",
  "system_note",
] as const;
export type PatientCommunicationType =
  (typeof PATIENT_COMMUNICATION_TYPES)[number];

export const PATIENT_COMMUNICATION_DIRECTIONS = [
  "outbound",
  "inbound",
  "internal",
] as const;
export type PatientCommunicationDirection =
  (typeof PATIENT_COMMUNICATION_DIRECTIONS)[number];

export const PATIENT_COMMUNICATION_STATUSES = [
  "draft",
  "queued",
  "sent",
  "delivered",
  "failed",
  "completed",
  "logged",
] as const;
export type PatientCommunicationStatus =
  (typeof PATIENT_COMMUNICATION_STATUSES)[number];

export const patientCommunications = pgTable(
  "patient_communications",
  {
    id: serial("id").primaryKey(),
    patientScreeningId: integer("patient_screening_id").references(
      () => patientScreenings.id,
      { onDelete: "set null" },
    ),
    executionCaseId: integer("execution_case_id").references(
      () => patientExecutionCases.id,
      { onDelete: "set null" },
    ),
    communicationType: text("communication_type").notNull(),
    direction: text("direction").notNull().default("outbound"),
    status: text("status").notNull().default("completed"),
    outcome: text("outcome"),
    subject: text("subject"),
    summary: text("summary").notNull(),
    bodyPreview: text("body_preview"),
    bodyFull: text("body_full"),
    toAddress: text("to_address"),
    fromAddress: text("from_address"),
    phoneNumber: text("phone_number"),
    actorUserId: varchar("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorNameSnapshot: text("actor_name_snapshot"),
    facility: text("facility"),
    relatedDocumentIds: jsonb("related_document_ids").default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    isTest: boolean("is_test").notNull().default(false),
  },
  (t) => [
    index("idx_patient_communications_patient_screening_id").on(
      t.patientScreeningId,
    ),
    index("idx_patient_communications_execution_case_id").on(t.executionCaseId),
    index("idx_patient_communications_type").on(t.communicationType),
    index("idx_patient_communications_actor_user_id").on(t.actorUserId),
    index("idx_patient_communications_occurred_at").on(t.occurredAt),
    index("idx_patient_communications_status").on(t.status),
  ],
);

export const insertPatientCommunicationSchema = createInsertSchema(
  patientCommunications,
).extend({
  communicationType: z.enum(PATIENT_COMMUNICATION_TYPES),
  direction: z.enum(PATIENT_COMMUNICATION_DIRECTIONS).default("outbound"),
  status: z.enum(PATIENT_COMMUNICATION_STATUSES).default("completed"),
});

export type PatientCommunication = typeof patientCommunications.$inferSelect;
export type InsertPatientCommunication =
  typeof patientCommunications.$inferInsert;
