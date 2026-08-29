// Call handoffs repository (Phase 3C / K6). Thin data-access layer over the
// call_handoffs table. All ownership/eligibility/notification logic lives in
// the service; this file is pure CRUD + focused reads.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  callHandoffs,
  type CallHandoff,
  type InsertCallHandoff,
} from "@shared/schema";

// Statuses that mean the handoff is still "live" (counts toward workload).
const OPEN_STATUSES = ["pending", "acknowledged"] as const;

export const callHandoffsRepository = {
  async create(record: InsertCallHandoff): Promise<CallHandoff> {
    const [row] = await db.insert(callHandoffs).values(record).returning();
    return row;
  },

  async getById(id: number): Promise<CallHandoff | undefined> {
    const [row] = await db
      .select()
      .from(callHandoffs)
      .where(eq(callHandoffs.id, id))
      .limit(1);
    return row;
  },

  async update(id: number, patch: Partial<CallHandoff>): Promise<CallHandoff | undefined> {
    const [row] = await db
      .update(callHandoffs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(callHandoffs.id, id))
      .returning();
    return row;
  },

  /** Open (pending/acknowledged) handoffs addressed TO a user, newest first. */
  async listOpenForRecipient(toUserId: string): Promise<CallHandoff[]> {
    return db
      .select()
      .from(callHandoffs)
      .where(
        and(
          eq(callHandoffs.toUserId, toUserId),
          inArray(callHandoffs.status, OPEN_STATUSES as unknown as string[]),
        ),
      )
      .orderBy(desc(callHandoffs.createdAt));
  },

  /** Open handoffs for a set of execution cases (right-rail display join). */
  async listOpenForExecutionCases(
    executionCaseIds: number[],
  ): Promise<CallHandoff[]> {
    if (executionCaseIds.length === 0) return [];
    return db
      .select()
      .from(callHandoffs)
      .where(
        and(
          inArray(callHandoffs.executionCaseId, executionCaseIds),
          inArray(callHandoffs.status, OPEN_STATUSES as unknown as string[]),
        ),
      );
  },

  /** Count OPEN P1/P2 handoffs per recipient user id (for the capacity model's
   *  priorityHandoffs field). Returns Map<userId, count>. */
  async countOpenPriorityByRecipient(): Promise<Map<string, number>> {
    const rows = await db
      .select({
        toUserId: callHandoffs.toUserId,
        n: sql<number>`count(*)::int`,
      })
      .from(callHandoffs)
      .where(
        and(
          inArray(callHandoffs.status, OPEN_STATUSES as unknown as string[]),
          inArray(callHandoffs.priorityLevel, ["P1", "P2"]),
        ),
      )
      .groupBy(callHandoffs.toUserId);
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.toUserId) map.set(r.toUserId, Number(r.n));
    }
    return map;
  },

  /** Manager view: recent handoffs (all statuses) enriched with from/to
   *  usernames, newest first, capped. */
  async listForManager(limit = 200): Promise<
    (CallHandoff & { fromUsername: string | null; toUsername: string | null })[]
  > {
    const rows = await db
      .select({
        h: callHandoffs,
        fromUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${callHandoffs.fromUserId})`,
        toUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${callHandoffs.toUserId})`,
      })
      .from(callHandoffs)
      .orderBy(desc(callHandoffs.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      ...r.h,
      fromUsername: r.fromUsername ?? null,
      toUsername: r.toUsername ?? null,
    }));
  },

  /** Handoffs for one execution case, all statuses, oldest first — feeds the
   *  ownership timeline (3E). */
  async listForExecutionCase(executionCaseId: number): Promise<CallHandoff[]> {
    return db
      .select()
      .from(callHandoffs)
      .where(eq(callHandoffs.executionCaseId, executionCaseId))
      .orderBy(callHandoffs.createdAt);
  },

  /** Phase 6C — cancel all OPEN handoffs addressed TO a user (e.g. the
   *  recipient was deactivated: an inbound pending handoff must not remain
   *  silently actionable). Kept for audit; metadata records the reason.
   *  Returns the affected rows so the caller can notify managers + clear the
   *  recipient's notifications. */
  async cancelOpenForRecipient(
    toUserId: string,
    reason: string,
    cancelledByUserId: string | null,
  ): Promise<CallHandoff[]> {
    return db
      .update(callHandoffs)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledByUserId,
        updatedAt: new Date(),
        metadata: sql`COALESCE(${callHandoffs.metadata}, '{}'::jsonb) || ${JSON.stringify({ cancelReason: reason })}::jsonb`,
      })
      .where(
        and(
          eq(callHandoffs.toUserId, toUserId),
          inArray(callHandoffs.status, OPEN_STATUSES as unknown as string[]),
        ),
      )
      .returning();
  },

  /** Phase 6B (req 6) — mark all OPEN handoffs on a case as `superseded`,
   *  EXCLUDING the given handoff id (the winner). Kept for audit (never
   *  deleted). Returns the affected rows so the caller can clear their
   *  now-stale recipient notifications. Atomic single UPDATE with a WHERE guard
   *  on the open statuses so it can't clobber a concurrently completed row. */
  async supersedeOpenForCase(
    executionCaseId: number,
    exceptHandoffId: number,
    supersededByHandoffId: number,
  ): Promise<CallHandoff[]> {
    const rows = await db
      .update(callHandoffs)
      .set({
        status: "superseded",
        updatedAt: new Date(),
        metadata: sql`COALESCE(${callHandoffs.metadata}, '{}'::jsonb) || ${JSON.stringify({ supersededByHandoffId })}::jsonb`,
      })
      .where(
        and(
          eq(callHandoffs.executionCaseId, executionCaseId),
          sql`${callHandoffs.id} <> ${exceptHandoffId}`,
          inArray(callHandoffs.status, OPEN_STATUSES as unknown as string[]),
        ),
      )
      .returning();
    return rows;
  },
};
