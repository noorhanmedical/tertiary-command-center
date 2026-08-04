// Phase 2I — ACS canonical-view client feature flag.
//
// Mirrors the server FEATURE_ACS_CANONICAL_VIEW flag. Default OFF: when off, the
// Ancillary Care Specialist workspace renders EXACTLY as before and issues ZERO
// /api/acs/canonical-view requests. Independent of the PCS flag so the two
// surfaces roll out separately.

const ACS_ENV = "VITE_FEATURE_ACS_CANONICAL_VIEW";

function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}
function isTruthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** True only when VITE_FEATURE_ACS_CANONICAL_VIEW is explicitly on. */
export function isAcsCanonicalViewEnabled(): boolean {
  return isTruthy(readEnv()[ACS_ENV]);
}
