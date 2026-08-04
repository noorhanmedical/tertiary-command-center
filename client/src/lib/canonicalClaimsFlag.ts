// Phase 2J — canonical claims client feature flag. Mirrors the server
// FEATURE_CANONICAL_CLAIMS flag. Default OFF: when off, the Finance surface renders EXACTLY
// as before and issues ZERO canonical-claims requests.
const ENV_KEY = "VITE_FEATURE_CANONICAL_CLAIMS";
function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}
function isTruthy(v: string | undefined): boolean { return v === "1" || v === "true" || v === "yes"; }
/** True only when VITE_FEATURE_CANONICAL_CLAIMS is explicitly on. */
export function isCanonicalClaimsEnabled(): boolean { return isTruthy(readEnv()[ENV_KEY]); }
