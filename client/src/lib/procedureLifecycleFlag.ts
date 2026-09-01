// Phase 2F — canonical Procedure Note client feature flag definition.
//
// Mirrors the server FEATURE_CANONICAL_PROCEDURE_NOTE flag for later UI work.
// Default OFF: Phase 2F-A ships NO new UI, so nothing reads this yet — it is
// defined now so the eventual Procedure Note surface has a single, consistent
// gate (same pattern as unifiedAncillaryDocumentsFlag). When OFF, every
// affected surface renders EXACTLY as before and issues ZERO Phase 2F requests.
//
// Vite injects VITE_* env vars at build time onto import.meta.env
// (not process.env in the browser).

const CANONICAL_PROCEDURE_NOTE_ENV = "VITE_FEATURE_CANONICAL_PROCEDURE_NOTE";

function readEnv(): Record<string, string | undefined> {
  const env = (import.meta as ImportMeta & { env?: { [k: string]: string | undefined } }).env;
  return env ?? {};
}

function isTruthyFlag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** True only when VITE_FEATURE_CANONICAL_PROCEDURE_NOTE is explicitly on. */
export function isCanonicalProcedureNoteUiEnabled(): boolean {
  return isTruthyFlag(readEnv()[CANONICAL_PROCEDURE_NOTE_ENV]);
}
