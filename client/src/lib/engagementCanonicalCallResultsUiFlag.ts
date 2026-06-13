// Engagement canonical call-results UI flag.
//
// PHASE-1 CANONICAL CALL-RESULT DEFAULT (Slice 1.4): canonical is now
// the default. UI clients call the plural endpoint
//   POST /api/engagement-center/call-results
// unless the rollback flag VITE_LEGACY_CALL_RESULT_ROLLBACK is truthy,
// in which case the resolver returns the legacy singular endpoint
//   POST /api/engagement-center/call-result
// This inverts the polarity established in Batch 12 of the Engagement
// completion run (where canonical was opt-in via
// VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI). Both flags are
// honored for back-compat — if EITHER the rollback flag is truthy OR
// the legacy VITE_USE_... flag is explicitly set to "0"/"false"/"no",
// we fall back to legacy.
//
// IMPORTANT: when the UI is in canonical mode (the new default), the
// server-side USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT must also
// be ON (also now the default). Operations is responsible for
// flipping both rollback flags in lockstep per the rollout in
// docs/architecture/engagement-ui-canonical-write-switch-plan.md.

const ROLLBACK_FLAG_ENV = "VITE_LEGACY_CALL_RESULT_ROLLBACK";
const LEGACY_OPT_IN_ENV = "VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI";

function readEnv(): Record<string, string | undefined> {
  // Vite injects user-defined VITE_* env vars at build time onto
  // import.meta.env. They are not available via process.env in the
  // browser. Vite documents this surface as ImportMetaEnv.
  const env = (import.meta as ImportMeta & {
    env?: { [k: string]: string | undefined };
  }).env;
  return env ?? {};
}

function isTruthyFlag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

function isFalseFlag(v: string | undefined): boolean {
  return v === "0" || v === "false" || v === "no";
}

export function isLegacyCallResultRollbackEnabled(): boolean {
  const env = readEnv();
  // 1. Explicit rollback flag wins.
  if (isTruthyFlag(env[ROLLBACK_FLAG_ENV])) return true;
  // 2. Legacy opt-in flag explicitly set to false also forces legacy
  //    (preserves the prior "canonical = opt-in" contract for any
  //    operator who set it explicitly to "0"/"false"/"no").
  if (isFalseFlag(env[LEGACY_OPT_IN_ENV])) return true;
  return false;
}

/**
 * @deprecated Use {@link engagementCallResultEndpoint} directly. After
 * the Slice 1.4 polarity flip this returns `!rollback`, so it's only
 * useful for source-level inspection of the back-compat behavior.
 */
export function isEngagementCanonicalCallResultsUiEnabled(): boolean {
  return !isLegacyCallResultRollbackEnabled();
}

/**
 * Resolves the engagement-center call-result endpoint path. After
 * Slice 1.4, this returns the canonical plural endpoint by default
 * and falls back to the legacy singular endpoint only when the
 * rollback flag is truthy.
 */
export function engagementCallResultEndpoint(): string {
  return isLegacyCallResultRollbackEnabled()
    ? "/api/engagement-center/call-result"
    : "/api/engagement-center/call-results";
}
