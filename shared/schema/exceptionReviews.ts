// exception_review_events — Phase 3 PR 3.3.

import {
  sql, pgTable, serial, text, integer, timestamp, jsonb, index, varchar,
  createInsertSchema, z,
} from "./_common";
import { exceptionSnapshots } from "./exceptionSnapshots";
import { users } from "./users";

export const EXCEPTION_REVIEW_EVENT_TYPES = [
  "acknowledged",
  "assigned",
  "note_added",
  "dismissed",
  "resolved",
  "reopened",
  "recommendation_accepted",
  "recommendation_rejected",
] as const;
export type ExceptionReviewEventType = (typeof EXCEPTION_REVIEW_EVENT_TYPES)[number];

export const exceptionReviewEvents = pgTable("exception_review_events", {
  id: serial("id").primaryKey(),
  exceptionSnapshotId: integer("exception_snapshot_id")
    .notNull()
    .references(() => exceptionSnapshots.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedRole: text("assigned_role"),
  reason: text("reason"),
  note: text("note"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_exception_review_events_snapshot_id").on(table.exceptionSnapshotId),
  index("idx_exception_review_events_event_type").on(table.eventType),
]);

export const insertExceptionReviewEventSchema = createInsertSchema(exceptionReviewEvents).omit({ id: true, createdAt: true });
export type ExceptionReviewEvent = typeof exceptionReviewEvents.$inferSelect;
export type InsertExceptionReviewEvent = z.infer<typeof insertExceptionReviewEventSchema>;
