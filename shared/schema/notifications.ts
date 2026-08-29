import {
  sql, pgTable, serial, text, varchar, integer, timestamp, jsonb,
  index, uniqueIndex, createInsertSchema, z,
} from "./_common";
import { users } from "./users";
import { patientScreenings } from "./screening";

// ─── Unified operational NOTIFICATIONS (Phase 6A) ───────────────────────────
//
// A lightweight canonical DELIVERY / SIGNAL layer. It does NOT replace or
// duplicate the source-of-truth records (messages, tasks, handoffs, calls,
// needs-coverage). Each row carries minimal PHI (a short operator-facing
// title/body) plus canonical pointers so a click-through opens the real
// workspace. One recipient per row; read/ack lifecycle tracked on the row.

export const NOTIFICATION_TYPES = [
  "direct_message",
  "team_message",
  "task_assigned",
  "task_due",
  "task_overdue",
  "handoff_received",
  "handoff_ack_required",
  "handoff_overdue",
  "call_reassigned",
  "callback_due",
  "needs_coverage",
  "manager_escalation",
  "redistribution_failed",
  "user_deactivated_work_released",
  "system_alert",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Fatigue tiers (req 3). HIGH surfaces prominently + may push; NORMAL is a
// standard inbox item; LOW is quiet (no badge emphasis). The producer decides
// the tier per type via notificationSeverityForType().
export const NOTIFICATION_SEVERITIES = ["HIGH", "NORMAL", "LOW"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientUserId: varchar("recipient_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("NORMAL"),
  title: text("title").notNull(),
  shortBody: text("short_body"),
  // Canonical record pointers (all optional). We reference the business record,
  // never copy it. Only patientScreeningId has a real FK (SET NULL); the rest
  // are loose ids so a notification survives even if the linked row is pruned.
  patientScreeningId: integer("patient_screening_id")
    .references(() => patientScreenings.id, { onDelete: "set null" }),
  executionCaseId: integer("execution_case_id"),
  taskId: integer("task_id"),
  handoffId: integer("handoff_id"),
  conversationId: integer("conversation_id"),
  facilityId: text("facility_id"),
  priorityLevel: text("priority_level"),
  // Dedupe key — at most one live row per (recipient, dedupeKey). NULL never
  // dedupes. Used so re-emitting the same signal updates rather than duplicates.
  dedupeKey: text("dedupe_key"),
  metadata: jsonb("metadata"),
  readAt: timestamp("read_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("idx_notifications_recipient").on(table.recipientUserId),
  index("idx_notifications_recipient_unread").on(table.recipientUserId, table.readAt),
  index("idx_notifications_type").on(table.type),
  index("idx_notifications_created").on(table.createdAt),
  uniqueIndex("uq_notifications_dedupe").on(table.recipientUserId, table.dedupeKey),
]);

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true, createdAt: true })
  .extend({
    type: z.enum(NOTIFICATION_TYPES),
    severity: z.enum(NOTIFICATION_SEVERITIES).optional(),
    title: z.string().min(1).max(200),
    shortBody: z.string().max(500).optional().nullable(),
  });

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// ─── Fatigue rules (req 3) ───────────────────────────────────────────────────
// Canonical severity per type so producers never guess. HIGH = urgent/needs
// attention now; NORMAL = standard inbox; LOW = quiet/no emphasis.
const HIGH_TYPES = new Set<NotificationType>([
  "handoff_ack_required",
  "handoff_overdue",
  "needs_coverage",
  "redistribution_failed",
  "callback_due",
  "task_overdue",
  "manager_escalation",
  "user_deactivated_work_released",
]);
const LOW_TYPES = new Set<NotificationType>([
  "team_message",
]);

export function notificationSeverityForType(
  type: NotificationType,
): NotificationSeverity {
  if (HIGH_TYPES.has(type)) return "HIGH";
  if (LOW_TYPES.has(type)) return "LOW";
  return "NORMAL";
}
