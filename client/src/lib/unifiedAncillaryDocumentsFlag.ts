// Phase 2E-B — Unified Ancillary Documents client feature flags.
//
// Mirror the server FEATURE_UNIFIED_ANCILLARY_DOCUMENTS /
// FEATURE_CANONICAL_ORDER_NOTE flags for client rendering. Default OFF: when
// off, every affected surface renders EXACTLY as before and issues ZERO
// canonical (/api/ancillary-documents) requests.
//
// Vite injects VITE_* env vars at build time onto import.meta.env
// (not process.env in the browser).

const UNIFIED_ENV = "VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS";
const CANONICAL_ORDER_NOTE_ENV = "VITE_FEATURE_CANONICAL_ORDER_NOTE";

function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}

function isTruthyFlag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** True only when VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS is explicitly on. */
export function isUnifiedAncillaryDocumentsEnabled(): boolean {
  return isTruthyFlag(readEnv()[UNIFIED_ENV]);
}

/** True only when VITE_FEATURE_CANONICAL_ORDER_NOTE is explicitly on. */
export function isCanonicalOrderNoteUiEnabled(): boolean {
  return isTruthyFlag(readEnv()[CANONICAL_ORDER_NOTE_ENV]);
}
