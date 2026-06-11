// Engagement canonical PLURAL call-results endpoint flag (Batch 8 of
// Engagement completion run).
//
// DEFAULT: OFF. When OFF the new POST /api/engagement-center/call-results
// endpoint returns 404 — clients that depend on it fail loudly until
// staging verification clears the flip. When ON, the plural endpoint
// shares the singular endpoint's handler so both routes behave
// byte-equivalent (no split-brain).

const FLAG_ENV = "USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT";

export function isEngagementCanonicalCallResultsEndpointEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
