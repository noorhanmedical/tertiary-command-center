// First-class internal team messaging (Phase 1, decision K3).
//
// One canonical conversation model replaces the fragmented mock inbox +
// orphaned direct_messages. Supports five conversation TYPES:
//   - direct   : exactly two members (1:1)
//   - team     : a team/channel conversation (teamId wired in Phase 4 K4)
//   - task     : discussion tied to a plexus task (taskId) — NOTE: existing
//                plexus_task_messages remains the task-thread source of truth;
//                this type is reserved for future convergence, not used yet.
//   - patient  : internal operational conversation optionally referencing a
//                patient (patientScreeningId / executionCaseId). This is an
//                INTERNAL team communication — it must NEVER be written into
//                clinical encounters/physician notes.
//   - system   : assignment/handoff/escalation workflow notifications.
//
// PERMANENT EXCLUSION: this model is INTERNAL user-to-user only. It must never
// carry patient-facing SMS/Twilio or external vendor messaging. Recipients are
// always internal users of the same clinic tenancy.
//
// Migration: migrations/0065_add_messaging.sql. No feature flag gate — this is
// the canonical messaging backend that replaces the mock.

import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb,
  index, uniqueIndex, boolean, createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { clinics } from "./clinics";
import { patientScreenings } from "./screening";

export const MESSAGE_CONVERSATION_TYPES = [
  "direct",
  "team",
  "task",
  "patient",
  "system",
] as const;
export type MessageConversationType = (typeof MESSAGE_CONVERSATION_TYPES)[number];

export const MESSAGE_CONVERSATION_STATUSES = ["active", "archived"] as const;
export type MessageConversationStatus = (typeof MESSAGE_CONVERSATION_STATUSES)[number];

export const messageConversations = pgTable("message_conversations", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").references(() => clinics.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title"),
  facilityId: text("facility_id"),
  // Wired to canonical teams in Phase 4 (K4). Nullable until then.
  teamId: integer("team_id"),
  // Optional operational context. NOT clinical.
  patientScreeningId: integer("patient_screening_id").references(() => patientScreenings.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id"),
  taskId: integer("task_id"),
  // For a `direct` conversation, a stable dedupe key = sorted "u1|u2" so a
  // 1:1 pair maps to exactly one conversation. Null for non-direct types.
  directKey: text("direct_key"),
  status: text("status").notNull().default("active"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_msg_conv_clinic").on(table.clinicId),
  index("idx_msg_conv_type").on(table.type),
  index("idx_msg_conv_team").on(table.teamId),
  index("idx_msg_conv_patient").on(table.patientScreeningId),
  index("idx_msg_conv_last_message_at").on(table.lastMessageAt),
  // One direct conversation per (clinic, sorted user pair).
  uniqueIndex("uq_msg_conv_direct_key")
    .on(table.clinicId, table.directKey)
    .where(sql`direct_key IS NOT NULL`),
]);

export const messageConversationMembers = pgTable("message_conversation_members", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => messageConversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // "owner" | "member" — reserved for team channels; direct pairs are members.
  memberRole: text("member_role").notNull().default("member"),
  // Canonical unread source of truth (K3): messages after lastReadAt from
  // other senders are unread. Null = never read.
  lastReadAt: timestamp("last_read_at"),
  active: boolean("active").notNull().default(true),
  joinedAt: timestamp("joined_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  leftAt: timestamp("left_at"),
}, (table) => [
  index("idx_msg_member_user").on(table.userId),
  uniqueIndex("uq_msg_member_conversation_user").on(table.conversationId, table.userId),
]);

// NOTE: named `team_messages` (not `messages`) to avoid colliding with the
// existing AI-chat `messages` table in shared/models/chat.ts, which is a
// separate live model (role/content) used by the Replit chat integration.
export const teamMessages = pgTable("team_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => messageConversations.id, { onDelete: "cascade" }),
  senderUserId: varchar("sender_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  // "user" | "system" — system messages (handoff/assignment notices) carry
  // no human sender.
  messageType: text("message_type").notNull().default("user"),
  metadata: jsonb("metadata").default({}),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_team_messages_conversation").on(table.conversationId, table.createdAt),
  index("idx_team_messages_sender").on(table.senderUserId),
]);

export const insertMessageConversationSchema = createInsertSchema(messageConversations).omit({
  id: true, createdAt: true, updatedAt: true, lastMessageAt: true,
}).extend({
  type: z.enum(MESSAGE_CONVERSATION_TYPES),
  status: z.enum(MESSAGE_CONVERSATION_STATUSES).optional(),
});
export const insertMessageConversationMemberSchema = createInsertSchema(messageConversationMembers).omit({
  id: true, joinedAt: true,
});
export const insertTeamMessageSchema = createInsertSchema(teamMessages).omit({
  id: true, createdAt: true, editedAt: true, deletedAt: true,
}).extend({
  body: z.string().min(1).max(4000),
  messageType: z.enum(["user", "system"]).optional(),
});

export type MessageConversation = typeof messageConversations.$inferSelect;
export type InsertMessageConversation = z.infer<typeof insertMessageConversationSchema>;
export type MessageConversationMember = typeof messageConversationMembers.$inferSelect;
export type InsertMessageConversationMember = z.infer<typeof insertMessageConversationMemberSchema>;
export type TeamMessage = typeof teamMessages.$inferSelect;
export type InsertTeamMessage = z.infer<typeof insertTeamMessageSchema>;

/** Stable dedupe key for a 1:1 direct conversation: sorted "a|b". */
export function directKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join("|");
}
