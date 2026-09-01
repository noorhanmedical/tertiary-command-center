// Notifications repository (Phase 6A). Thin data access over the operational
// notification delivery layer. The SERVICE (notificationService) owns fatigue
// rules, dedupe, and the live-bus nudge; this repo is pure persistence.

import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  notifications,
  type Notification,
  type InsertNotification,
} from "@shared/schema";

export const notificationsRepository = {
  /** Insert a notification. When dedupeKey is set, an existing LIVE row for the
   *  same (recipient, dedupeKey) is refreshed instead of duplicated (keeps the
   *  center from spamming the same operational signal). */
  async create(record: InsertNotification): Promise<Notification> {
    if (record.dedupeKey) {
      const [row] = await db
        .insert(notifications)
        .values(record)
        .onConflictDoUpdate({
          target: [notifications.recipientUserId, notifications.dedupeKey],
          // Match the PARTIAL unique index predicate (WHERE dedupe_key IS NOT
          // NULL) so Postgres uses uq_notifications_dedupe for the upsert.
          targetWhere: sql`${notifications.dedupeKey} IS NOT NULL`,
          set: {
            type: record.type,
            severity: record.severity ?? "NORMAL",
            title: record.title,
            shortBody: record.shortBody ?? null,
            patientScreeningId: record.patientScreeningId ?? null,
            executionCaseId: record.executionCaseId ?? null,
            taskId: record.taskId ?? null,
            handoffId: record.handoffId ?? null,
            conversationId: record.conversationId ?? null,
            facilityId: record.facilityId ?? null,
            priorityLevel: record.priorityLevel ?? null,
            metadata: record.metadata ?? null,
            expiresAt: record.expiresAt ?? null,
            // Re-surface: a refreshed signal is unread again.
            readAt: null,
            acknowledgedAt: null,
            createdAt: new Date(),
          },
        })
        .returning();
      return row;
    }
    const [row] = await db.insert(notifications).values(record).returning();
    return row;
  },

  /** Recent notifications for a recipient (newest first), excluding expired. */
  async listForRecipient(
    recipientUserId: string,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<Notification[]> {
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
    // Use the DB clock (now()) for the expiry compare so it matches the naive
    // `timestamp` column exactly — passing a JS Date can shift by the local tz
    // offset and mis-classify a just-expired row as still live.
    const conds = [
      eq(notifications.recipientUserId, recipientUserId),
      or(isNull(notifications.expiresAt), sql`${notifications.expiresAt} > now()`),
    ];
    if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
    return db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  },

  /** Unread count for the badge. Excludes expired rows. */
  async unreadCount(recipientUserId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
          or(isNull(notifications.expiresAt), sql`${notifications.expiresAt} > now()`),
        ),
      );
    return Number(row?.n ?? 0);
  },

  /** Mark one notification read — scoped to the recipient (authorization). */
  async markRead(id: number, recipientUserId: string): Promise<Notification | undefined> {
    const [row] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
        ),
      )
      .returning();
    return row;
  },

  /** Explicitly acknowledge a high-signal notification (also marks read). */
  async acknowledge(id: number, recipientUserId: string): Promise<Notification | undefined> {
    const now = new Date();
    const [row] = await db
      .update(notifications)
      .set({ acknowledgedAt: now, readAt: sql`COALESCE(${notifications.readAt}, ${now})` })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientUserId, recipientUserId),
        ),
      )
      .returning();
    return row;
  },

  /** Mark all of a recipient's unread notifications read. Returns count. */
  async markAllRead(recipientUserId: string): Promise<number> {
    const rows = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  },

  /** Bulk-expire live rows matching any of the given dedupe keys for a
   *  recipient (e.g. a handoff was acknowledged elsewhere → drop its ack
   *  notification). Best-effort helper for stale-state convergence. */
  async expireByDedupeKeys(recipientUserId: string, dedupeKeys: string[]): Promise<number> {
    if (dedupeKeys.length === 0) return 0;
    const rows = await db
      .update(notifications)
      .set({ expiresAt: sql`now()` })
      .where(
        and(
          eq(notifications.recipientUserId, recipientUserId),
          inArray(notifications.dedupeKey, dedupeKeys),
          or(isNull(notifications.expiresAt), sql`${notifications.expiresAt} > now()`),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  },

  /** Housekeeping: hard-delete rows that expired before `before`. */
  async purgeExpired(before: Date): Promise<number> {
    const rows = await db
      .delete(notifications)
      .where(and(sql`${notifications.expiresAt} IS NOT NULL`, lte(notifications.expiresAt, before)))
      .returning({ id: notifications.id });
    return rows.length;
  },
};
