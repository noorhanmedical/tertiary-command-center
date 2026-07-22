// Phase 2D-C2 — canonical appointment UI feature flag.
//
// Mirrors the server FEATURE_CANONICAL_APPOINTMENT flag for client
// rendering. Default OFF: when off, portal clients must render exactly
// as before and mount no canonical appointment components.
//
// Vite injects VITE_* env vars at build time onto import.meta.env
// (not process.env in the browser).

const CANONICAL_APPOINTMENT_ENV = "VITE_FEATURE_CANONICAL_APPOINTMENT";

function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & {
    env?: { [k: string]: string | undefined };
  }).env;
  return env ?? {};
}

function isTruthyFlag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** True only when VITE_FEATURE_CANONICAL_APPOINTMENT is explicitly on. */
export function isCanonicalAppointmentUiEnabled(): boolean {
  return isTruthyFlag(readEnv()[CANONICAL_APPOINTMENT_ENV]);
}
