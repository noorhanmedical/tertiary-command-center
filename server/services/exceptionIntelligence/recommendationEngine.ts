// recommendationEngine — Phase 3 PR 3.5.
//
// Iterates open exception snapshots, runs the matching recommendation
// rule, and persists the result as an ai_recommendation_logs row. Never
// executes anything — humans review via /admin/ai-recommendations.

import { listExceptions } from "../../repositories/exceptionSnapshots.repo";
import { getEffectiveExceptionPolicy } from "./exceptionSettingsService";
import { getEffectiveAiSafetyPolicy } from "./aiSafetyPolicyService";
import { logProposal } from "./aiRecommendationLogService";
import {
  getRuleForExceptionType,
  RECOMMENDATION_VERSION,
} from "./recommendationRules";

export type RecommendEvaluationResult = {
  proposed: number;
  skipped: number;
  unsupported: number;
};

export async function proposeRecommendationsForOpenExceptions(
  scope: { facilityId?: string | null; testType?: string | null } = {},
): Promise<RecommendEvaluationResult> {
  const facilityId = scope.facilityId ?? null;
  const testType = scope.testType ?? null;
  const policy = await getEffectiveExceptionPolicy({ facilityId, testType });
  const safety = await getEffectiveAiSafetyPolicy({ facilityId, testType });
  const policySnapshot = { exception: policy, ai_safety: safety };

  const open = await listExceptions(
    { status: ["open", "acknowledged", "in_review"], facilityId: facilityId ?? undefined },
    500,
  );

  let proposed = 0;
  let skipped = 0;
  let unsupported = 0;

  for (const ex of open) {
    const rule = getRuleForExceptionType(ex.exceptionType);
    if (!rule) { unsupported++; continue; }
    const proposal = rule({ exception: ex, safety, policySnapshot });
    if (!proposal) { skipped++; continue; }

    // Phase 3 default — rules-only. Even if safety policy permits a model,
    // PR 3.5 only proposes rule outputs. Honour the contract: provider
    // must be rules_engine and confidence not_applicable.
    const recommendationKey = `${ex.exceptionType}:${ex.id}`;

    await logProposal({
      recommendationKey,
      exceptionSnapshotId: ex.id,
      recommendationType: proposal.recommendationType,
      recommendedAction: proposal.recommendedAction,
      title: proposal.title,
      body: proposal.body,
      modelProvider: "rules_engine",
      modelName: null,
      confidenceLabel: "not_applicable",
      ruleIds: proposal.ruleIds,
      rationale: proposal.rationale,
      inputs: proposal.inputs,
      policySnapshot,
      sourceSnapshot: (ex.sourceSnapshot as Record<string, unknown>) ?? {},
      detectorVersion: RECOMMENDATION_VERSION,
    });
    proposed++;
  }

  return { proposed, skipped, unsupported };
}
