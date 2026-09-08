// Durable daily-reconciliation RUN ledger repository (Phase 2B).
//
// Records execution STATE for the clinic-local 5 AM canonical engagement
// reconciliation. One logical run per (clinicId, operationalDate, jobType),
// enforced by uq_err_clinic_date_job, with mutable status + attempt_count.
// Retry-safe: a failed/started row is UPDATED in place on the next attempt, so
// a failure never blocks a later successful retry.
//
// This repository stores NO PHI — only clinic id, operational-date string,
// timezone id, run status/attempt/trigger, a PHI-safe failure summary, and
// non-PHI aggregate counts.

import { and, eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  engagementReconciliationRuns,
  type EngagementReconciliationRun,
  type ReconciliationRunStatus,
  type ReconciliationTriggerType,
} from "@shared/schema/reconciliationRuns";

const DEFAULT_JOB_TYPE = "daily_engagement_reconciliation";

export type ReconciliationRunKey = {
  clinicId: number;
  operationalDate: string;
  jobType?: string;
};

export type ReconciliationRunCounts = {
  candidateCount?: number | null;
  assignedCount?: number | null;
  needsCoverageCount?: number | null;
  skippedCount?: number | null;
};

function jobOf(key: ReconciliationRunKey): string {
  return key.jobType ?? DEFAULT_JOB_TYPE;
}

/** The current ledger row for a run identity, if any. */
export async function findRun(
  key: ReconciliationRunKey,
): Promise<EngagementReconciliationRun | undefined> {
  const [row] = await db
    .select()
    .from(engagementReconciliationRuns)
    .where(
      and(
        eq(engagementReconciliationRuns.clinicId, key.clinicId),
        eq(engagementReconciliationRuns.operationalDate, key.operationalDate),
        eq(engagementReconciliationRuns.jobType, jobOf(key)),
      ),
    )
    .limit(1);
  return row;
}

/** DURABLE authority: has this clinic already SUCCESSFULLY reconciled for this
 *  operational date + job? (The authoritative "skip already done" check.) */
export async function hasSucceededRun(key: ReconciliationRunKey): Promise<boolean> {
  const row = await findRun(key);
  return row?.status === "succeeded";
}

/**
 * Mark a run STARTED (attempt N). Upserts the single logical run row: first
 * attempt inserts attempt_count=1; a retry of a non-succeeded row increments
 * attempt_count, clears completed_at, and re-arms started_at. Callers MUST have
 * already confirmed (under the advisory lock) that no succeeded row exists.
 */
export async function beginRun(input: {
  clinicId: number;
  operationalDate: string;
  jobType?: string;
  timeZone: string | null;
  triggerType: ReconciliationTriggerType;
}): Promise<EngagementReconciliationRun> {
  const now = new Date();
  const [row] = await db
    .insert(engagementReconciliationRuns)
    .values({
      clinicId: input.clinicId,
      operationalDate: input.operationalDate,
      jobType: input.jobType ?? DEFAULT_JOB_TYPE,
      timeZone: input.timeZone,
      triggerType: input.triggerType,
      status: "started",
      attemptCount: 1,
      startedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        engagementReconciliationRuns.clinicId,
        engagementReconciliationRuns.operationalDate,
        engagementReconciliationRuns.jobType,
      ],
      set: {
        status: "started",
        attemptCount: sql`${engagementReconciliationRuns.attemptCount} + 1`,
        timeZone: input.timeZone,
        triggerType: input.triggerType,
        startedAt: now,
        completedAt: null,
        failureCode: null,
        failureSummary: null,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

/** Mark a started run SUCCEEDED with non-PHI outcome counts. */
export async function completeRunSuccess(
  id: number,
  counts: ReconciliationRunCounts = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(engagementReconciliationRuns)
    .set({
      status: "succeeded",
      completedAt: now,
      updatedAt: now,
      candidateCount: counts.candidateCount ?? null,
      assignedCount: counts.assignedCount ?? null,
      needsCoverageCount: counts.needsCoverageCount ?? null,
      skippedCount: counts.skippedCount ?? null,
    })
    .where(eq(engagementReconciliationRuns.id, id));
}

/** Mark a started run FAILED (retryable) with a PHI-safe code + summary. */
export async function completeRunFailure(
  id: number,
  failure: { failureCode: string; failureSummary?: string | null },
): Promise<void> {
  const now = new Date();
  await db
    .update(engagementReconciliationRuns)
    .set({
      status: "failed",
      completedAt: now,
      updatedAt: now,
      failureCode: failure.failureCode,
      failureSummary: failure.failureSummary ?? null,
    })
    .where(eq(engagementReconciliationRuns.id, id));
}

/**
 * Record a CONFIGURATION_ERROR (e.g. invalid/missing clinic timezone) — the
 * clinic did NOT reconcile and the allocator was NOT run. Upserts the run row
 * so the state is durable + observable. operationalDate here is a deterministic
 * key (the UTC calendar date) when the clinic-local date is uncomputable.
 */
export async function recordConfigurationError(input: {
  clinicId: number;
  operationalDate: string;
  jobType?: string;
  timeZone: string | null;
  failureCode: string;
  failureSummary?: string | null;
}): Promise<EngagementReconciliationRun> {
  const now = new Date();
  const [row] = await db
    .insert(engagementReconciliationRuns)
    .values({
      clinicId: input.clinicId,
      operationalDate: input.operationalDate,
      jobType: input.jobType ?? DEFAULT_JOB_TYPE,
      timeZone: input.timeZone,
      triggerType: null,
      status: "configuration_error",
      attemptCount: 1,
      startedAt: now,
      completedAt: now,
      failureCode: input.failureCode,
      failureSummary: input.failureSummary ?? null,
    })
    .onConflictDoUpdate({
      target: [
        engagementReconciliationRuns.clinicId,
        engagementReconciliationRuns.operationalDate,
        engagementReconciliationRuns.jobType,
      ],
      set: {
        status: "configuration_error",
        attemptCount: sql`${engagementReconciliationRuns.attemptCount} + 1`,
        timeZone: input.timeZone,
        completedAt: now,
        failureCode: input.failureCode,
        failureSummary: input.failureSummary ?? null,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

/** Operational read: recent runs (optionally scoped by clinic). No PHI. */
export async function listRecentRuns(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<EngagementReconciliationRun[]> {
  const limit = Math.min(Math.max(1, args?.limit ?? 100), 500);
  const conds = args?.clinicId != null
    ? [eq(engagementReconciliationRuns.clinicId, args.clinicId)]
    : [];
  const q = db.select().from(engagementReconciliationRuns);
  const rows = conds.length
    ? await q.where(and(...conds)).orderBy(desc(engagementReconciliationRuns.updatedAt)).limit(limit)
    : await q.orderBy(desc(engagementReconciliationRuns.updatedAt)).limit(limit);
  return rows;
}

export type { ReconciliationRunStatus };
