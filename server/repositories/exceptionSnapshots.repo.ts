// exceptionSnapshots.repo — Phase 3 PR 3.2.

import { db } from "../db";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  exceptionSnapshots,
  type ExceptionSnapshot,
  type InsertExceptionSnapshot,
} from "@shared/schema/exceptionSnapshots";

export type ListFilters = {
  status?: string | string[];
  severity?: string | string[];
  exceptionType?: string | string[];
  facilityId?: string;
  ownerRole?: string;
  executionCaseId?: number;
  invoiceId?: number;
};

export async function listExceptions(filters: ListFilters = {}, limit = 200): Promise<ExceptionSnapshot[]> {
  const conditions: any[] = [];
  if (filters.facilityId) conditions.push(eq(exceptionSnapshots.facilityId, filters.facilityId));
  if (filters.executionCaseId != null) conditions.push(eq(exceptionSnapshots.executionCaseId, filters.executionCaseId));
  if (filters.invoiceId != null) conditions.push(eq(exceptionSnapshots.invoiceId, filters.invoiceId));
  if (filters.ownerRole) conditions.push(eq(exceptionSnapshots.recommendedOwnerRole, filters.ownerRole));

  let q = db.select().from(exceptionSnapshots).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const rows = await q.orderBy(desc(exceptionSnapshots.detectedAt)).limit(Math.min(Math.max(1, limit), 1000));

  const statusFilter = Array.isArray(filters.status) ? filters.status : filters.status ? [filters.status] : null;
  const severityFilter = Array.isArray(filters.severity) ? filters.severity : filters.severity ? [filters.severity] : null;
  const typeFilter = Array.isArray(filters.exceptionType) ? filters.exceptionType : filters.exceptionType ? [filters.exceptionType] : null;

  return rows.filter((r) => {
    if (statusFilter && !statusFilter.includes(r.status)) return false;
    if (severityFilter && !severityFilter.includes(r.severity)) return false;
    if (typeFilter && !typeFilter.includes(r.exceptionType)) return false;
    return true;
  });
}

export async function getException(id: number): Promise<ExceptionSnapshot | undefined> {
  const [row] = await db.select().from(exceptionSnapshots).where(eq(exceptionSnapshots.id, id)).limit(1);
  return row;
}

export async function getExceptionByKey(key: string): Promise<ExceptionSnapshot | undefined> {
  const [row] = await db.select().from(exceptionSnapshots).where(eq(exceptionSnapshots.exceptionKey, key)).limit(1);
  return row;
}

export async function upsertException(input: InsertExceptionSnapshot): Promise<{ row: ExceptionSnapshot; created: boolean }> {
  const existing = await getExceptionByKey(input.exceptionKey);
  if (existing) {
    // Refresh — keep status / human review fields intact. Update
    // last_seen_at + explanation + severity (in case threshold
    // bumps severity later) + sourceSnapshot.
    const [row] = await db
      .update(exceptionSnapshots)
      .set({
        explanation: input.explanation,
        severity: input.severity ?? existing.severity,
        recommendedOwnerRole: input.recommendedOwnerRole ?? existing.recommendedOwnerRole,
        title: input.title ?? existing.title,
        sourceSnapshot: input.sourceSnapshot ?? existing.sourceSnapshot,
        policySnapshot: input.policySnapshot ?? existing.policySnapshot,
        metadata: input.metadata ?? existing.metadata,
        lastSeenAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      } as any)
      .where(eq(exceptionSnapshots.id, existing.id))
      .returning();
    return { row, created: false };
  }
  const [row] = await db.insert(exceptionSnapshots).values(input).returning();
  return { row, created: true };
}

export async function markSuperseded(id: number): Promise<ExceptionSnapshot | undefined> {
  const [row] = await db
    .update(exceptionSnapshots)
    .set({
      status: "superseded",
      resolvedAt: sql`CURRENT_TIMESTAMP`,
      supersededByEngine: 1,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    } as any)
    .where(eq(exceptionSnapshots.id, id))
    .returning();
  return row;
}
