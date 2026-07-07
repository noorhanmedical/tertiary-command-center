import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  analysisJobs,
  type AnalysisJob,
  type InsertAnalysisJob,
} from "@shared/schema/analysisJobs";
import { screeningBatches } from "@shared/schema/screening";

export interface IAnalysisJobsRepository {
  create(record: InsertAnalysisJob): Promise<AnalysisJob>;
  update(id: number, updates: Partial<InsertAnalysisJob>): Promise<AnalysisJob | undefined>;
  incrementProgress(jobId: number): Promise<void>;
  latestByBatch(batchId: number): Promise<AnalysisJob | undefined>;
  /**
   * Plexus IQ runtime hardening — duplicate-job guard.
   * Returns the most recent `status='running'` job for the batch, or
   * undefined when none. Used by `startBatchAnalysis` to make Generate
   * idempotent: a duplicate click while a job is in flight returns the
   * existing jobId instead of starting another loop.
   */
  activeByBatch(batchId: number): Promise<AnalysisJob | undefined>;
  recent(limit: number): Promise<Array<AnalysisJob & { batchName: string }>>;
  failRunning(errorMessage: string): Promise<void>;
  purgeOld(olderThanDays: number): Promise<void>;
}

export class DbAnalysisJobsRepository implements IAnalysisJobsRepository {
  async create(record: InsertAnalysisJob): Promise<AnalysisJob> {
    const [result] = await db.insert(analysisJobs).values(record).returning();
    return result;
  }

  async update(id: number, updates: Partial<InsertAnalysisJob>): Promise<AnalysisJob | undefined> {
    const [result] = await db.update(analysisJobs).set(updates).where(eq(analysisJobs.id, id)).returning();
    return result;
  }

  async incrementProgress(jobId: number): Promise<void> {
    await db.update(analysisJobs)
      .set({ completedPatients: sql`${analysisJobs.completedPatients} + 1` })
      .where(eq(analysisJobs.id, jobId));
  }

  async latestByBatch(batchId: number): Promise<AnalysisJob | undefined> {
    const [result] = await db.select().from(analysisJobs)
      .where(eq(analysisJobs.batchId, batchId))
      .orderBy(desc(analysisJobs.startedAt))
      .limit(1);
    return result;
  }

  async activeByBatch(batchId: number): Promise<AnalysisJob | undefined> {
    const [result] = await db.select().from(analysisJobs)
      .where(and(
        eq(analysisJobs.batchId, batchId),
        eq(analysisJobs.status, "running"),
      ))
      .orderBy(desc(analysisJobs.startedAt))
      .limit(1);
    return result;
  }

  async recent(limit: number): Promise<Array<AnalysisJob & { batchName: string }>> {
    const rows = await db
      .select({
        id: analysisJobs.id,
        batchId: analysisJobs.batchId,
        status: analysisJobs.status,
        totalPatients: analysisJobs.totalPatients,
        completedPatients: analysisJobs.completedPatients,
        errorMessage: analysisJobs.errorMessage,
        metadata: analysisJobs.metadata,
        startedAt: analysisJobs.startedAt,
        completedAt: analysisJobs.completedAt,
        batchName: screeningBatches.name,
      })
      .from(analysisJobs)
      .leftJoin(screeningBatches, eq(analysisJobs.batchId, screeningBatches.id))
      .orderBy(desc(analysisJobs.startedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, batchName: r.batchName ?? `Batch #${r.batchId}` }));
  }

  async failRunning(errorMessage: string): Promise<void> {
    await db.update(analysisJobs)
      .set({ status: "failed", errorMessage, completedAt: new Date() })
      .where(eq(analysisJobs.status, "running"));
  }

  async purgeOld(olderThanDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    await db.delete(analysisJobs).where(and(
      sql`${analysisJobs.completedAt} IS NOT NULL`,
      sql`${analysisJobs.completedAt} < ${cutoff}`,
    ));
  }
}

export const analysisJobsRepository: IAnalysisJobsRepository = new DbAnalysisJobsRepository();
