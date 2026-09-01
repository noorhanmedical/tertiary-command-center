// Needs-coverage repository (Phase 3D / K8). Structured "why is this case
// uncovered" state. NOT ownership — the case stays canonically unassigned.

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  needsCoverage,
  type NeedsCoverage,
  type InsertNeedsCoverage,
} from "@shared/schema";

export const needsCoverageRepository = {
  /** Upsert the needs-coverage row for a case (one row per execution case).
   *  Re-opens (clears resolvedAt) if a prior row had been resolved. */
  async upsert(record: InsertNeedsCoverage): Promise<NeedsCoverage> {
    const [row] = await db
      .insert(needsCoverage)
      .values({ ...record, resolvedAt: null, resolvedByUserId: null })
      .onConflictDoUpdate({
        target: needsCoverage.executionCaseId,
        set: {
          category: record.category,
          reason: record.reason,
          priorityLevel: record.priorityLevel ?? null,
          facilityId: record.facilityId ?? null,
          patientScreeningId: record.patientScreeningId ?? null,
          source: record.source ?? "distribution",
          metadata: record.metadata ?? null,
          resolvedAt: null,
          resolvedByUserId: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  /** Mark the given cases resolved (they got an owner / manager cleared). */
  async resolveForCases(
    executionCaseIds: number[],
    resolvedByUserId: string | null = null,
  ): Promise<number> {
    if (executionCaseIds.length === 0) return 0;
    const rows = await db
      .update(needsCoverage)
      .set({ resolvedAt: new Date(), resolvedByUserId, updatedAt: new Date() })
      .where(
        and(
          inArray(needsCoverage.executionCaseId, executionCaseIds),
          isNull(needsCoverage.resolvedAt),
        ),
      )
      .returning({ id: needsCoverage.id });
    return rows.length;
  },

  /** Open (unresolved) needs-coverage rows, newest first. Optional filters. */
  async listOpen(filters: { category?: string; facilityId?: string } = {}): Promise<NeedsCoverage[]> {
    const conds = [isNull(needsCoverage.resolvedAt)];
    if (filters.category) conds.push(eq(needsCoverage.category, filters.category));
    if (filters.facilityId) conds.push(eq(needsCoverage.facilityId, filters.facilityId));
    return db
      .select()
      .from(needsCoverage)
      .where(and(...conds))
      .orderBy(desc(needsCoverage.createdAt));
  },

  /** Count of open rows grouped by category (manager summary). */
  async countOpenByCategory(): Promise<Record<string, number>> {
    const rows = await db
      .select({ category: needsCoverage.category, n: sql<number>`count(*)::int` })
      .from(needsCoverage)
      .where(isNull(needsCoverage.resolvedAt))
      .groupBy(needsCoverage.category);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.category] = Number(r.n);
    return out;
  },

  async getForCase(executionCaseId: number): Promise<NeedsCoverage | undefined> {
    const [row] = await db
      .select()
      .from(needsCoverage)
      .where(eq(needsCoverage.executionCaseId, executionCaseId))
      .limit(1);
    return row;
  },
};
