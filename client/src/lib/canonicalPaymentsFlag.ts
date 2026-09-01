// Phase 2J — canonical payments client feature flag. Mirrors the server
// FEATURE_CANONICAL_PAYMENTS flag. Default OFF: when off, the Finance surface renders EXACTLY
// as before and issues ZERO canonical-payments requests.
const ENV_KEY = "VITE_FEATURE_CANONICAL_PAYMENTS";
function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}
function isTruthy(v: string | undefined): boolean { return v === "1" || v === "true" || v === "yes"; }
/** True only when VITE_FEATURE_CANONICAL_PAYMENTS is explicitly on. */
export function isCanonicalPaymentsEnabled(): boolean { return isTruthy(readEnv()[ENV_KEY]); }
