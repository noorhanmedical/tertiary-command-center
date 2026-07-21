/**
 * Phase 2C — Service-level Engagement queue projection.
 *
 * Shared by every real queue reader (assignment board, PCS list,
 * executionCases card list). When
 * FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC is ON:
 *
 *   • An execution case is eligible only when at least one of its
 *     ancillary cases has admin_review_status='approved'.
 *   • When multi-list flag is ALSO ON, that ancillary case must have
 *     at least one active membership.
 *   • The eligibleServices[] array carries the specific approved
 *     services — one execution case with (BrainWave approved,
 *     Ultrasound rejected) surfaces only "BrainWave" so the UI can
 *     render service-level rows.
 *
 * Throws on any repo error — callers translate to 503 rather than
 * broadening visibility.
 */

import { listAncillaryCasesForExecutionCase } from "../../repositories/ancillaryCases.repo";
import { listActiveMembershipsForAncillaryCase } from "../../repositories/engagementLists.repo";

export type QueueProjectionInput<T extends { id: number }> = {
  executionCases: T[];
  requireActiveMembership: boolean;
};

export type QueueProjectionRow<T extends { id: number }> = {
  executionCase: T;
  eligibleServices: string[];
};

export async function projectServiceLevelEligibility<T extends { id: number }>(
  input: QueueProjectionInput<T>,
): Promise<QueueProjectionRow<T>[]> {
  const out: QueueProjectionRow<T>[] = [];
  for (const c of input.executionCases) {
    // eslint-disable-next-line no-await-in-loop
    const ancillary = await listAncillaryCasesForExecutionCase(c.id);
    const approved = ancillary.filter(
      (a) =>
        a.adminReviewStatus === "approved" &&
        (a.lifecycleStatus === "new" ||
          a.lifecycleStatus === "active" ||
          a.lifecycleStatus === "on_hold"),
    );
    if (approved.length === 0) continue;

    if (input.requireActiveMembership) {
      const withMembership: typeof approved = [];
      for (const a of approved) {
        // eslint-disable-next-line no-await-in-loop
        const memberships = await listActiveMembershipsForAncillaryCase(a.id);
        if (memberships.length > 0) withMembership.push(a);
      }
      if (withMembership.length === 0) continue;
      out.push({
        executionCase: c,
        eligibleServices: Array.from(new Set(withMembership.map((a) => a.serviceType))),
      });
    } else {
      out.push({
        executionCase: c,
        eligibleServices: Array.from(new Set(approved.map((a) => a.serviceType))),
      });
    }
  }
  return out;
}
