// callPriorityService — Phase 3 PR 3.7.
//
// Ranks open call-related exception snapshots into a deterministic
// queue for PCS / ACS users. Purely rule-based scoring; no model is
// consulted. The service does not mutate any state.

import { listExceptions } from "../../repositories/exceptionSnapshots.repo";
import type { ExceptionSnapshot } from "@shared/schema/exceptionSnapshots";

export const CALL_PRIORITY_VERSION = "3.7.0";

const CALL_RELATED_TYPES = new Set([
  "callback_overdue",
  "lvm_followup_overdue",
  "no_answer_followup_overdue",
  "unable_to_reach_threshold_met",
  "ready_to_schedule_stale",
  "stale_queue_item",
  "missing_patient_contact",
]);

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100, high: 70, medium: 40, low: 20, info: 10,
};

export type CallPriorityItem = {
  exception: ExceptionSnapshot;
  score: number;
  reasons: string[];
};

export type CallPriorityFilters = {
  facilityId?: string | null;
  ownerRole?: string | null;
};

export async function computeCallPriorityQueue(
  filters: CallPriorityFilters = {},
  limit = 100,
): Promise<{ version: string; items: CallPriorityItem[] }> {
  const open = await listExceptions(
    {
      status: ["open", "acknowledged", "in_review"],
      facilityId: filters.facilityId ?? undefined,
      ownerRole: filters.ownerRole ?? undefined,
    },
    500,
  );

  const now = Date.now();
  const items: CallPriorityItem[] = [];

  for (const ex of open) {
    if (!CALL_RELATED_TYPES.has(ex.exceptionType)) continue;
    const reasons: string[] = [];
    let score = 0;

    const sevWeight = SEVERITY_WEIGHT[ex.severity] ?? 10;
    score += sevWeight;
    reasons.push(`severity:${ex.severity}(+${sevWeight})`);

    const detectedAt = ex.detectedAt instanceof Date
      ? ex.detectedAt.getTime()
      : new Date(ex.detectedAt as any).getTime();
    if (Number.isFinite(detectedAt)) {
      const hoursOpen = Math.max(0, (now - detectedAt) / 3600_000);
      const ageBonus = Math.min(50, Math.floor(hoursOpen));
      score += ageBonus;
      reasons.push(`age:${hoursOpen.toFixed(1)}h(+${ageBonus})`);
    }

    const snap = (ex.sourceSnapshot ?? {}) as Record<string, unknown>;
    const explicitOverdue = Number(snap.hoursOverdue ?? snap.overdueHours ?? snap.hoursPending ?? 0);
    if (Number.isFinite(explicitOverdue) && explicitOverdue > 0) {
      const overdueBonus = Math.min(40, Math.floor(explicitOverdue / 2));
      score += overdueBonus;
      reasons.push(`overdue:${explicitOverdue}h(+${overdueBonus})`);
    }

    if (filters.ownerRole && ex.recommendedOwnerRole && filters.ownerRole === ex.recommendedOwnerRole) {
      score += 5;
      reasons.push("owner-match(+5)");
    }

    items.push({ exception: ex, score, reasons });
  }

  items.sort((a, b) => b.score - a.score);
  return { version: CALL_PRIORITY_VERSION, items: items.slice(0, limit) };
}
