// Engagement call-result response shape — fixture (Batch 8).
//
// PINS the response envelope of POST /api/engagement-center/call-result
// (singular) at the byte-key level. The future engagement delegation
// (Batch 12) MUST keep returning these keys with these nullability
// rules. Adding a NEW key is non-breaking and allowed; removing or
// renaming any key IS breaking and forbidden.
//
// Data-only fixture. Not wired to any route. No PHI.

export const ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS = [
  "ok",
  "executionCase",
  "journeyEvent",
  "triageCase",
  "task",
  "ownershipUpdated",
] as const;
export type EngagementCallResultResponseKey =
  (typeof ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS)[number];

/**
 * Each key's nullability and rough shape.
 *   "always"   — present on every response.
 *   "nullable" — may be present as `null` (not undefined).
 */
export const ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY: Readonly<
  Record<EngagementCallResultResponseKey, "always" | "nullable">
> = {
  ok: "always",            // boolean true on success path
  executionCase: "nullable", // execution case row, or null if not resolved
  journeyEvent: "nullable",  // journey event row, or null if append failed
  triageCase: "nullable",    // triage row, or null if not opened
  task: "nullable",          // plexus_task row, or null if not created
  ownershipUpdated: "always", // boolean
};

/**
 * The minimum set of canonical outcomes the engagement route MUST
 * support without changing the response shape.
 */
export const ENGAGEMENT_CALL_RESULT_SUPPORTED_OUTCOMES = [
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
] as const;

/**
 * Import-time sanity check.
 */
{
  const seen = new Set<string>();
  for (const k of ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS) {
    if (seen.has(k)) throw new Error(`engagement response shape fixture: duplicate key "${k}"`);
    seen.add(k);
    if (!(k in ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY)) {
      throw new Error(`engagement response shape fixture: missing nullability for "${k}"`);
    }
  }
}
