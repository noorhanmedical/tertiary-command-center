// Repository for the durable large-file import job ledger (import_jobs).
// Thin CRUD + status transitions. No business logic — the runner owns that.

import { db } from "../db";
import { importJobs, type ImportJob } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";

// Use the drizzle-inferred insert type so server-owned columns (completedAt,
// cursorRow, counts, etc.) are settable on both create and update.
type ImportJobInsert = typeof importJobs.$inferInsert;

export async function createImportJob(values: ImportJobInsert): Promise<ImportJob> {
  const [row] = await db.insert(importJobs).values(values as never).returning();
  return row;
}

export async function getImportJob(id: number): Promise<ImportJob | undefined> {
  const [row] = await db.select().from(importJobs).where(eq(importJobs.id, id)).limit(1);
  return row;
}

export async function updateImportJob(
  id: number,
  updates: Partial<ImportJobInsert>,
): Promise<ImportJob | undefined> {
  const [row] = await db
    .update(importJobs)
    .set({ ...updates, updatedAt: new Date() } as never)
    .where(eq(importJobs.id, id))
    .returning();
  return row;
}

/** Find an existing job for an idempotency key within a clinic (retry-safe). */
export async function findImportJobByIdempotencyKey(
  clinicId: number | null,
  idempotencyKey: string,
): Promise<ImportJob | undefined> {
  const conds = [eq(importJobs.idempotencyKey, idempotencyKey)];
  if (clinicId != null) conds.push(eq(importJobs.clinicId, clinicId));
  else conds.push(sql`clinic_id IS NULL`);
  const [row] = await db.select().from(importJobs).where(and(...conds)).limit(1);
  return row;
}

export async function listRecentImportJobs(
  clinicId: number | null,
  limit = 50,
): Promise<ImportJob[]> {
  const q = db.select().from(importJobs).$dynamic();
  const rows = clinicId != null
    ? await q.where(eq(importJobs.clinicId, clinicId)).orderBy(desc(importJobs.startedAt)).limit(limit)
    : await q.orderBy(desc(importJobs.startedAt)).limit(limit);
  return rows;
}

/** Jobs whose temp artifact is eligible for cleanup (expired). `expires_at` is
 *  a `timestamp without time zone` storing the UTC wall-clock (drizzle's Date →
 *  toISOString default), so we compare against a UTC wall-clock STRING cast to
 *  timestamp — never a raw Date, which node-postgres would serialize in the
 *  process timezone and shift the comparison. */
export async function listExpiredImportJobs(now: Date = new Date()): Promise<ImportJob[]> {
  const nowUtc = now.toISOString().slice(0, 19).replace("T", " ");
  return db
    .select()
    .from(importJobs)
    .where(and(sql`expires_at IS NOT NULL`, sql`expires_at < ${nowUtc}::timestamp`, sql`temp_path IS NOT NULL`));
}

// ─── POSSIBLE_MATCH decisions ────────────────────────────────────────────────
import {
  importRowDecisions,
  type ImportRowDecisionRow,
  type ImportRowDecision,
} from "@shared/schema";

/** Upsert a manager's resolution for one POSSIBLE_MATCH row (idempotent). */
export async function upsertImportRowDecision(input: {
  importJobId: number;
  rowIndex: number;
  decision: ImportRowDecision;
  matchedScreeningId?: number | null;
  resolvedByUserId?: string | null;
}): Promise<ImportRowDecisionRow> {
  const [row] = await db
    .insert(importRowDecisions)
    .values({
      importJobId: input.importJobId,
      rowIndex: input.rowIndex,
      decision: input.decision,
      matchedScreeningId: input.matchedScreeningId ?? null,
      resolvedByUserId: input.resolvedByUserId ?? null,
    } as never)
    .onConflictDoUpdate({
      target: [importRowDecisions.importJobId, importRowDecisions.rowIndex],
      set: {
        decision: input.decision,
        matchedScreeningId: input.matchedScreeningId ?? null,
        resolvedByUserId: input.resolvedByUserId ?? null,
        resolvedAt: new Date(),
      } as never,
    })
    .returning();
  return row;
}

/** All decisions for a job, as a Map keyed by row index. */
export async function loadImportRowDecisions(
  importJobId: number,
): Promise<Map<number, ImportRowDecisionRow>> {
  const rows = await db
    .select()
    .from(importRowDecisions)
    .where(eq(importRowDecisions.importJobId, importJobId));
  const out = new Map<number, ImportRowDecisionRow>();
  for (const r of rows) out.set(r.rowIndex, r);
  return out;
}
