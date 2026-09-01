// Phase 2H — Clinician Portal canonical live-data client feature flag.
//
// Mirrors the server FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA flag. Default OFF:
// when off, the Clinician Portal renders EXACTLY as before and issues ZERO
// /api/clinician-portal/canonical-overview requests. Vite injects VITE_* env
// vars at build time onto import.meta.env (not process.env in the browser).

const CANONICAL_DATA_ENV = "VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA";

function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}
function isTruthyFlag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** True only when VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA is explicitly on. */
export function isClinicianPortalCanonicalDataEnabled(): boolean {
  return isTruthyFlag(readEnv()[CANONICAL_DATA_ENV]);
}
