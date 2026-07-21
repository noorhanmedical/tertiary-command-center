/**
 * Phase 2C — Engagement reconciliation retry service.
 *
 * Idempotent by construction:
 *   • Every reconcile call is safe to invoke multiple times.
 *   • Resolving an already-resolved failure is a no-op.
 *   • Restoring an already-active membership is a no-op.
 *
 * Not registered as any clinic-facing route. Intended for background
 * jobs or admin CLIs.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../../lib/featureFlags";
import {
  listUnresolvedEngagementReconciliations,
  recordEngagementReconciliationFailure,
  resolveEngagementReconciliationFailure,
} from "../../repositories/engagementLists.repo";
import { reconcileEngagementEligibility } from "./reconciliation";
import type { EngagementReconciliationFailure } from "@shared/schema/engagementLists";

export type RetryOutcome =
  | { status: "flag_off" }
  | { status: "resolved"; failureId: number }
  | { status: "still_failing"; failureId: number; code?: string };

async function retryOne(f: EngagementReconciliationFailure): Promise<RetryOutcome> {
  // Reload the ancillary case to derive current status. This is what
  // makes the retry idempotent — the reconciler reads the current
  // truth, not the historically failed intent.
  let previousStatus: string | null = f.previousAdminReviewStatus ?? null;
  let newStatus: string | null = f.newAdminReviewStatus ?? null;
  if (f.ancillaryCaseId != null) {
    const [row] = await db
      .select()
      .from(patientAncillaryCases)
      .where(eq(patientAncillaryCases.id, f.ancillaryCaseId))
      .limit(1);
    if (row) {
      newStatus = (row.adminReviewStatus as string) ?? newStatus;
    }
  }
  if (!newStatus) {
    return { status: "still_failing", failureId: f.id, code: "no_new_status" };
  }

  try {
    await reconcileEngagementEligibility({
      clinicId: f.clinicId,
      patientScreeningId: f.patientScreeningId,
      ancillaryCaseId: f.ancillaryCaseId,
      serviceType: f.serviceType ?? "unknown",
      previousAdminReviewStatus: previousStatus as never,
      newAdminReviewStatus: newStatus as never,
      changedByUserId: null,
      source: "engagement_retry_service",
    });
    await resolveEngagementReconciliationFailure({
      ancillaryCaseId: f.ancillaryCaseId,
      patientScreeningId: f.patientScreeningId,
      serviceType: f.serviceType ?? undefined,
      requestedAction: f.requestedAction as never,
    });
    return { status: "resolved", failureId: f.id };
  } catch (e) {
    try {
      await recordEngagementReconciliationFailure({
        clinicId: f.clinicId,
        patientScreeningId: f.patientScreeningId,
        ancillaryCaseId: f.ancillaryCaseId,
        serviceType: f.serviceType,
        sourceListId: f.sourceListId,
        requestedAction: f.requestedAction as never,
        previousAdminReviewStatus: previousStatus,
        newAdminReviewStatus: newStatus,
        sourceSystem: "engagement_retry_service",
        errorCode: (e as { code?: string })?.code ?? "unknown",
      });
    } catch { /* nothing further */ }
    return { status: "still_failing", failureId: f.id, code: (e as { code?: string })?.code };
  }
}

export async function retryEngagementReconciliationFailure(
  failure: EngagementReconciliationFailure,
): Promise<RetryOutcome> {
  if (!featureFlags.engagementAdminReviewSync) return { status: "flag_off" };
  return retryOne(failure);
}

export async function retryUnresolvedEngagementReconciliations(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<{
  attempted: number;
  resolved: number;
  stillFailing: number;
  outcomes: RetryOutcome[];
}> {
  if (!featureFlags.engagementAdminReviewSync) {
    return { attempted: 0, resolved: 0, stillFailing: 0, outcomes: [] };
  }
  const failures = await listUnresolvedEngagementReconciliations(args);
  const outcomes: RetryOutcome[] = [];
  for (const f of failures) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await retryOne(f));
  }
  return {
    attempted: outcomes.length,
    resolved: outcomes.filter((o) => o.status === "resolved").length,
    stillFailing: outcomes.filter((o) => o.status === "still_failing").length,
    outcomes,
  };
}
