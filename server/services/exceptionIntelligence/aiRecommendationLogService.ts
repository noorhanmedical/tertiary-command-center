// aiRecommendationLogService — Phase 3 PR 3.4.
//
// Append-only log of every AI / rules recommendation produced. The engine
// inserts via logProposal(). Humans accept or reject. No automatic
// execution.

import { db } from "../../db";
import { eq, desc, sql, and } from "drizzle-orm";
import { aiRecommendationLogs } from "@shared/schema/aiRecommendationLogs";
import { exceptionReviewEvents } from "@shared/schema/exceptionReviews";
import { exceptionSnapshots } from "@shared/schema/exceptionSnapshots";
import {
  CONFIDENCE_LABELS, MODEL_PROVIDERS, RECOMMENDATION_ACTIONS,
  type ConfidenceLabel, type ModelProvider, type RecommendationAction,
} from "@shared/contracts/aiRecommendation";

export type LogProposalInput = {
  recommendationKey: string;
  exceptionSnapshotId: number | null;
  recommendationType: string;
  recommendedAction: RecommendationAction;
  title: string;
  body: string;
  modelProvider: ModelProvider;
  modelName: string | null;
  confidenceLabel: ConfidenceLabel;
  ruleIds: string[];
  rationale: string;
  inputs: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  detectorVersion: string | null;
};

function assertVocab(input: LogProposalInput): { ok: true } | { ok: false; error: string } {
  if (!(MODEL_PROVIDERS as readonly string[]).includes(input.modelProvider)) {
    return { ok: false, error: `Unknown modelProvider "${input.modelProvider}"` };
  }
  if (!(CONFIDENCE_LABELS as readonly string[]).includes(input.confidenceLabel)) {
    return { ok: false, error: `Unknown confidenceLabel "${input.confidenceLabel}"` };
  }
  if (!(RECOMMENDATION_ACTIONS as readonly string[]).includes(input.recommendedAction)) {
    return { ok: false, error: `Unknown recommendedAction "${input.recommendedAction}"` };
  }
  if (!input.rationale.trim()) {
    return { ok: false, error: "rationale is required" };
  }
  if (input.modelProvider === "rules_engine" && input.confidenceLabel !== "not_applicable") {
    return { ok: false, error: "rules_engine must report confidenceLabel=not_applicable" };
  }
  return { ok: true };
}

export async function logProposal(input: LogProposalInput) {
  const check = assertVocab(input);
  if (!check.ok) throw new Error(`Invalid recommendation: ${check.error}`);
  // Upsert by recommendation_key to keep dedupe deterministic. If the
  // existing row was already accepted/rejected, supersede it rather than
  // overwrite — preserves human audit trail.
  const existing = await db.select().from(aiRecommendationLogs)
    .where(eq(aiRecommendationLogs.recommendationKey, input.recommendationKey)).limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    if (row.status === "accepted" || row.status === "rejected") {
      await db.update(aiRecommendationLogs).set({
        status: "superseded",
        supersededAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      } as any).where(eq(aiRecommendationLogs.id, row.id));
    } else {
      // Refresh the proposed row in place.
      await db.update(aiRecommendationLogs).set({
        recommendationType: input.recommendationType,
        recommendedAction: input.recommendedAction,
        title: input.title,
        body: input.body,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        confidenceLabel: input.confidenceLabel,
        ruleIds: input.ruleIds,
        rationale: input.rationale,
        inputs: input.inputs,
        policySnapshot: input.policySnapshot,
        sourceSnapshot: input.sourceSnapshot,
        detectorVersion: input.detectorVersion,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      } as any).where(eq(aiRecommendationLogs.id, row.id));
      return row.id;
    }
  }
  const [inserted] = await db.insert(aiRecommendationLogs).values({
    recommendationKey: input.recommendationKey,
    exceptionSnapshotId: input.exceptionSnapshotId,
    recommendationType: input.recommendationType,
    recommendedAction: input.recommendedAction,
    title: input.title,
    body: input.body,
    modelProvider: input.modelProvider,
    modelName: input.modelName,
    confidenceLabel: input.confidenceLabel,
    ruleIds: input.ruleIds,
    rationale: input.rationale,
    inputs: input.inputs,
    policySnapshot: input.policySnapshot,
    sourceSnapshot: input.sourceSnapshot,
    detectorVersion: input.detectorVersion,
    status: "proposed",
    requiresHumanReview: 1,
  } as any).returning({ id: aiRecommendationLogs.id });
  return inserted.id;
}

export type AcceptRejectContext = { actorUserId: string | null; reason?: string };
export type ActionResult = { ok: true; status: string } | { ok: false; status: 400 | 404 | 409; error: string };

async function loadRow(id: number) {
  const [r] = await db.select().from(aiRecommendationLogs).where(eq(aiRecommendationLogs.id, id)).limit(1);
  return r;
}

export async function acceptRecommendation(id: number, ctx: AcceptRejectContext): Promise<ActionResult> {
  const row = await loadRow(id);
  if (!row) return { ok: false, status: 404, error: "Recommendation not found" };
  if (row.status !== "proposed") {
    return { ok: false, status: 409, error: `Cannot accept recommendation in status "${row.status}"` };
  }
  await db.update(aiRecommendationLogs).set({
    status: "accepted",
    acceptedAt: sql`CURRENT_TIMESTAMP`,
    acceptedByUserId: ctx.actorUserId,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(aiRecommendationLogs.id, id));
  if (row.exceptionSnapshotId) {
    await db.insert(exceptionReviewEvents).values({
      exceptionSnapshotId: row.exceptionSnapshotId,
      eventType: "recommendation_accepted",
      actorUserId: ctx.actorUserId,
      metadata: { recommendationLogId: id, recommendedAction: row.recommendedAction },
    } as any);
  }
  return { ok: true, status: "accepted" };
}

export async function rejectRecommendation(id: number, ctx: AcceptRejectContext): Promise<ActionResult> {
  const row = await loadRow(id);
  if (!row) return { ok: false, status: 404, error: "Recommendation not found" };
  if (row.status !== "proposed") {
    return { ok: false, status: 409, error: `Cannot reject recommendation in status "${row.status}"` };
  }
  const reason = (ctx.reason ?? "").trim();
  if (!reason) return { ok: false, status: 400, error: "Rejection reason required" };
  await db.update(aiRecommendationLogs).set({
    status: "rejected",
    rejectedAt: sql`CURRENT_TIMESTAMP`,
    rejectedByUserId: ctx.actorUserId,
    rejectionReason: reason,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as any).where(eq(aiRecommendationLogs.id, id));
  if (row.exceptionSnapshotId) {
    await db.insert(exceptionReviewEvents).values({
      exceptionSnapshotId: row.exceptionSnapshotId,
      eventType: "recommendation_rejected",
      actorUserId: ctx.actorUserId,
      reason,
      metadata: { recommendationLogId: id, recommendedAction: row.recommendedAction },
    } as any);
  }
  return { ok: true, status: "rejected" };
}

export async function listRecommendations(filters: {
  status?: string | string[];
  exceptionSnapshotId?: number;
  modelProvider?: string;
  recommendedAction?: string;
} = {}, limit = 200) {
  const where: any[] = [];
  if (filters.status) {
    where.push(Array.isArray(filters.status)
      ? sql`${aiRecommendationLogs.status} = ANY(${filters.status})`
      : eq(aiRecommendationLogs.status, filters.status));
  }
  if (filters.exceptionSnapshotId != null) {
    where.push(eq(aiRecommendationLogs.exceptionSnapshotId, filters.exceptionSnapshotId));
  }
  if (filters.modelProvider) where.push(eq(aiRecommendationLogs.modelProvider, filters.modelProvider));
  if (filters.recommendedAction) where.push(eq(aiRecommendationLogs.recommendedAction, filters.recommendedAction));
  const query = db.select().from(aiRecommendationLogs)
    .where(where.length ? and(...where) : undefined as any)
    .orderBy(desc(aiRecommendationLogs.createdAt))
    .limit(limit);
  return query;
}

export async function getRecommendation(id: number) {
  return loadRow(id);
}

// Reference re-exports so PR 3.5 can validate input.
export { exceptionSnapshots };
