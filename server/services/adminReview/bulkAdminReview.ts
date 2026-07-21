/**
 * Phase 2C — Bulk / same-day retroactive Admin Review domain service.
 *
 * NOT registered as a route. The Plexus-internal clinical reviewer
 * role does not exist yet (see authorization.ts blocker), so the
 * bulk pathway is a DOMAIN-only service — its route registration is
 * an explicit follow-up when the role lands.
 *
 * Every ancillary case in the input is routed through
 * `recordAncillaryCaseAdminReview` so bulk reviews get:
 *   • append-only history
 *   • reviewer authorization
 *   • immutable server-generated actual_reviewed_at
 *   • evidence snapshot
 *   • Engagement reconciliation
 *   • screening compatibility projection
 *
 * Failures per-case are captured in the result; the caller receives
 * both successes and failures. No silent swallow. No fire-and-forget.
 */

import {
  recordAncillaryCaseAdminReview,
  type RecordAdminReviewInput,
  type RecordAdminReviewResult,
} from "./recordAdminReview";
import type { AncillaryReviewSource } from "@shared/schema/adminReviewEvents";

export type BulkAdminReviewInput = {
  /** One or many ancillary cases to review. All must share the same clinic scope. */
  ancillaryCaseIds: number[];
  clinicId: number;
  newStatus: string;
  effectiveClinicalDate?: string | null;
  rationale?: string | null;
  actor: { userId: string | null; role: string | null };
  /** "bulk" or "same_day_retroactive" — never "manual" from this entry point. */
  source: Extract<AncillaryReviewSource, "bulk" | "same_day_retroactive">;
};

export type BulkAdminReviewOutcome = {
  ancillaryCaseId: number;
  outcome: RecordAdminReviewResult | { status: "error"; code: string; message: string };
};

export type BulkAdminReviewResult = {
  attempted: number;
  recorded: number;
  crossClinicDenied: number;
  errors: number;
  outcomes: BulkAdminReviewOutcome[];
};

export async function recordBulkAdminReview(
  input: BulkAdminReviewInput,
): Promise<BulkAdminReviewResult> {
  const outcomes: BulkAdminReviewOutcome[] = [];
  for (const acId of input.ancillaryCaseIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await recordAncillaryCaseAdminReview({
        ancillaryCaseId: acId,
        clinicId: input.clinicId,
        newStatus: input.newStatus,
        effectiveClinicalDate: input.effectiveClinicalDate ?? null,
        rationale: input.rationale ?? null,
        actor: input.actor,
        source: input.source,
      });
      outcomes.push({ ancillaryCaseId: acId, outcome });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      outcomes.push({
        ancillaryCaseId: acId,
        outcome: {
          status: "error",
          code: err.code ?? "unknown",
          message: err.message ?? String(e),
        },
      });
    }
  }
  return {
    attempted: outcomes.length,
    recorded: outcomes.filter((o) => o.outcome.status === "recorded").length,
    crossClinicDenied: outcomes.filter((o) => o.outcome.status === "cross_clinic_denied").length,
    errors: outcomes.filter((o) => o.outcome.status === "error").length,
    outcomes,
  };
}
