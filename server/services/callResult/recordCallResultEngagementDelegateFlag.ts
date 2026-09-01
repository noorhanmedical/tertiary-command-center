// recordCallResult engagement-center delegation flag.
//
// DEFAULT: ON (canonical convergence). The engagement-center call-result
// route now derives its business semantics (callback timing, next-action,
// engagement-status transition, triage/task/ownership planning, step
// ordering) from the ONE canonical recordCallResult planner+adapter, via
// dep-injected writers that reproduce the legacy DB effects byte-equivalent.
//
// ROLLBACK: set LEGACY_CALL_RESULT_ROLLBACK=1 (or the specific
// USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE=0) to fall back to the inline
// legacy path. Explicit "0"/"false"/"no" on the specific flag also disables.
//
// REFERENCED CONTRACTS
//   - docs/architecture/engagement-canonical-call-result-endpoint-contract.md (Batch 6)
//   - docs/architecture/call-result-engagement-delegation-contract.md

const FLAG_ENV = "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE";
const ROLLBACK_ENV = "LEGACY_CALL_RESULT_ROLLBACK";

export function isRecordCallResultEngagementDelegateEnabled(): boolean {
  // Global rollback wins.
  const rb = process.env[ROLLBACK_ENV];
  if (rb === "1" || rb === "true" || rb === "yes") return false;
  const v = process.env[FLAG_ENV];
  // Explicit opt-out.
  if (v === "0" || v === "false" || v === "no") return false;
  // Default ON (converged), unless explicitly disabled above.
  return true;
}
