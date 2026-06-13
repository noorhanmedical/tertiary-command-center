// Engagement canonical PLURAL call-results endpoint flag.
//
// PHASE-1 CANONICAL CALL-RESULT DEFAULT (Slice 1.4): canonical is now
// the default. POST /api/engagement-center/call-results shares the
// SAME handler as the legacy singular endpoint, so the two routes are
// byte-equivalent. The plural endpoint is enabled by default; only an
// explicit rollback flag forces it back to 404.
//
// Rollback path: set LEGACY_CALL_RESULT_ROLLBACK to "1"/"true"/"yes"
// to force the plural endpoint to 404 (the prior default). The
// pre-existing USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT flag is
// still honored for back-compat — explicitly setting it to
// "0"/"false"/"no" also forces 404.

const ROLLBACK_FLAG_ENV = "LEGACY_CALL_RESULT_ROLLBACK";
const LEGACY_OPT_IN_ENV = "USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT";

function isTruthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

function isFalsey(v: string | undefined): boolean {
  return v === "0" || v === "false" || v === "no";
}

export function isEngagementCanonicalCallResultsEndpointEnabled(): boolean {
  if (isTruthy(process.env[ROLLBACK_FLAG_ENV])) return false;
  if (isFalsey(process.env[LEGACY_OPT_IN_ENV])) return false;
  return true;
}
