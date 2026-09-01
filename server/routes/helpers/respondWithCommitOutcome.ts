/**
 * Phase 2C — shared HTTP-response mapper for commitPatient callers.
 *
 * Any route that calls `commitPatient(...)` and returns to an HTTP
 * client MUST translate `result.data.engagementSend.status` into the
 * correct HTTP status. Duplicating this logic in every route makes it
 * easy to drift (as happened with /analyze silently returning 200 on
 * a failed send). One helper, one contract:
 *
 *   sent                → 200
 *   idempotent_existing → 200
 *   skipped_flag_off    → 200 (existing legacy contract)
 *   deferred            → 202
 *   failed              → 503
 *
 * The response body is the caller's `extra` object merged with
 * `engagementSend`. On failure a stable non-PHI error code is added.
 * The caller controls its own patient/analysis payload shape — this
 * helper only sets status + engagementSend metadata.
 */

import type { Response } from "express";
import type { CommitOutcome } from "../../services/patientCommitService";

export type CommitOutcomeResponseInput = {
  /**
   * The extra body fields the route wants in every response. Merged
   * with `engagementSend` on the top level.
   */
  extra?: Record<string, unknown>;
};

export function respondWithCommitOutcome(
  res: Response,
  outcome: CommitOutcome,
  input: CommitOutcomeResponseInput = {},
): Response {
  const engagementSend = outcome.engagementSend ?? { status: "skipped_flag_off" };
  const base = { ...(input.extra ?? {}), engagementSend };

  switch (engagementSend.status) {
    case "failed":
      return res.status(503).json({
        ...base,
        error: "Engagement send failed — durable retry queued",
        code: "ENGAGEMENT_SEND_FAILED",
      });
    case "deferred":
      return res.status(202).json({
        ...base,
        retryPending: engagementSend.retryPending ?? true,
      });
    case "sent":
    case "idempotent_existing":
    case "skipped_flag_off":
    default:
      return res.status(200).json(base);
  }
}
