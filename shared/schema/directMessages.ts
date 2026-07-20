// Internal direct-messages schema (INTERNAL user-to-user only).
//
// Migration file: migrations/0043_add_direct_messages.sql — must be
// approved separately before running. Feature flag
// FEATURE_INTERNAL_DIRECT_MESSAGES gates the runtime behavior.
//
// PERMANENT EXCLUSION: this schema MUST NOT be used for patient
// messaging, Twilio, or any external SMS vendor. Every read/write
// path enforces sender/recipient both being internal users of the
// same clinic tenancy.

import {
  sql, pgTable, serial, text, varchar, integer, timestamp, index, boolean,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";

export const directMessages = pgTable(
  "direct_messages",
  {
    id: serial("id").primaryKey(),
    // Tenant scope. Both sender and recipient must be in this clinic.
    clinicId: integer("clinic_id")
      .references(() => clinics.id, { onDelete: "cascade" })
      .notNull(),
    senderUserId: varchar("sender_user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipientUserId: varchar("recipient_user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    // Recipient inbox: fetch by recipient + clinic + read_at IS NULL.
    index("idx_dm_recipient_clinic").on(table.recipientUserId, table.clinicId),
    // Sender history: fetch by sender.
    index("idx_dm_sender").on(table.senderUserId),
    // Sort/pagination.
    index("idx_dm_created_at").on(table.createdAt),
  ],
);

export type DirectMessage = typeof directMessages.$inferSelect;
export type InsertDirectMessage = typeof directMessages.$inferInsert;
