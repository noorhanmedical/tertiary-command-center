// Patient SMS messages — real two-way texting between the practice and
// patients via the Twilio integration (Task #648).
//
// Every row is a REAL message: outbound rows are only written after the
// provider (Twilio) accepts the send (or written with status "failed" and
// the provider error preserved — never silently faked as sent). Inbound
// rows are written by the Twilio webhook. `senderUserId` on outbound rows
// is always taken from the server session, never from the client.
//
// Threads are keyed by the patient's phone number (normalized E.164-ish),
// with a best-effort `patientName` + `patientScreeningId` captured at send
// time so the tray can show who the conversation is with.
import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  index,
  createInsertSchema,
  z,
} from "./_common";
import { users } from "./users";

export const patientSmsMessages = pgTable(
  "patient_sms_messages",
  {
    id: serial("id").primaryKey(),
    /** Normalized patient phone number — the thread key. */
    patientPhone: text("patient_phone").notNull(),
    /** Best-effort display name for the thread (from the patient picker). */
    patientName: text("patient_name"),
    /** Optional link back to a screening row for journey logging. */
    patientScreeningId: integer("patient_screening_id"),
    /** "outbound" (practice → patient) or "inbound" (patient → practice). */
    direction: text("direction").notNull(),
    body: text("body").notNull(),
    /** Outbound only — the real logged-in sender (from the session). */
    senderUserId: varchar("sender_user_id").references(() => users.id),
    /** Twilio message SID when the provider returned one. */
    providerSid: text("provider_sid"),
    /** "sent" | "failed" (outbound) or "received" (inbound). */
    status: text("status").notNull(),
    /** Provider error message for failed sends — honest failure record. */
    errorMessage: text("error_message"),
    /** Inbound read tracking (unread badge). */
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    phoneIdx: index("patient_sms_messages_phone_idx").on(t.patientPhone),
    createdIdx: index("patient_sms_messages_created_idx").on(t.createdAt),
  }),
);

// Client send payload. Everything else (sender, status, provider fields)
// is decided server-side.
export const sendPatientSmsSchema = z.object({
  patientPhone: z.string().trim().min(7).max(32),
  patientName: z.string().trim().min(1).max(200).optional(),
  patientScreeningId: z.number().int().positive().optional(),
  body: z.string().trim().min(1).max(1600),
});

export const insertPatientSmsMessageSchema = createInsertSchema(patientSmsMessages).omit({
  id: true,
  createdAt: true,
});

export type PatientSmsMessage = typeof patientSmsMessages.$inferSelect;
export type InsertPatientSmsMessage = z.infer<typeof insertPatientSmsMessageSchema>;
export type SendPatientSmsInput = z.infer<typeof sendPatientSmsSchema>;
