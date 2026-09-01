// Phase 2J — canonical invoices client feature flag. Mirrors the server
// FEATURE_CANONICAL_INVOICES flag. Default OFF: when off, the Finance surface renders EXACTLY
// as before and issues ZERO canonical-invoices requests.
const ENV_KEY = "VITE_FEATURE_CANONICAL_INVOICES";
function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}
function isTruthy(v: string | undefined): boolean { return v === "1" || v === "true" || v === "yes"; }
/** True only when VITE_FEATURE_CANONICAL_INVOICES is explicitly on. */
export function isCanonicalInvoicesEnabled(): boolean { return isTruthy(readEnv()[ENV_KEY]); }
