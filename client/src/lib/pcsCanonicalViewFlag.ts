// Phase 2I — PCS canonical-view client feature flag.
//
// Mirrors the server FEATURE_PCS_CANONICAL_VIEW flag. Default OFF: when off, the
// Patient Care Specialist workspace renders EXACTLY as before and issues ZERO
// /api/pcs/canonical-view requests. Vite injects VITE_* env vars at build time
// onto import.meta.env (not process.env in the browser).

const PCS_ENV = "VITE_FEATURE_PCS_CANONICAL_VIEW";

function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}
function isTruthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** True only when VITE_FEATURE_PCS_CANONICAL_VIEW is explicitly on. */
export function isPcsCanonicalViewEnabled(): boolean {
  return isTruthy(readEnv()[PCS_ENV]);
}
