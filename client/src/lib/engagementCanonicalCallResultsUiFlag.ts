// Engagement canonical call-results UI flag (Batch 12 of Engagement
// completion run).
//
// DEFAULT: unset / falsy → UI uses the legacy singular endpoint.
// Truthy values: "1" / "true" / "yes" → UI uses the canonical plural
// endpoint POST /api/engagement-center/call-results.
//
// IMPORTANT: when the UI flag is ON, the server-side
// USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT MUST also be ON in
// the same environment — otherwise the server returns 404 and
// submissions fail loudly. Operations is responsible for enabling
// both flags in lockstep per the rollout in
// docs/architecture/engagement-ui-canonical-write-switch-plan.md.

const FLAG_ENV = "VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI";

export function isEngagementCanonicalCallResultsUiEnabled(): boolean {
  // Vite injects user-defined VITE_* env vars at build time onto
  // import.meta.env. They are not available via process.env in the
  // browser. Vite documents this surface as ImportMetaEnv.
  const env = (import.meta as ImportMeta & {
    env?: { [k: string]: string | undefined };
  }).env;
  const v = env?.[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Resolves the engagement-center call-result endpoint path based on
 * the UI flag. Used by DispositionSheet + CanonicalRowActions to
 * point at either the legacy singular endpoint (default) or the
 * canonical plural endpoint (when the flag is truthy).
 */
export function engagementCallResultEndpoint(): string {
  return isEngagementCanonicalCallResultsUiEnabled()
    ? "/api/engagement-center/call-results"
    : "/api/engagement-center/call-result";
}
