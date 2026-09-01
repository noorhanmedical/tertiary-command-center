// recordCallResult outreach delegation flag.
//
// DEFAULT: ON (canonical convergence). The /api/outreach/calls route routes
// its call-record creation through the canonical recordCallResult adapter
// (outreach executor owns outreachCallCreated + appointmentStatusUpdated +
// assignmentCompleted; engagement-only steps stay suppressed). The route still
// fires terminal assignment-completion + canonical-spine sync directly so the
// ordering matches legacy.
//
// ROLLBACK: set LEGACY_CALL_RESULT_ROLLBACK=1 (or the specific
// USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE=0) to fall back to the inline
// legacy atomic write.

const FLAG_ENV = "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE";
const ROLLBACK_ENV = "LEGACY_CALL_RESULT_ROLLBACK";

export function isRecordCallResultOutreachDelegateEnabled(): boolean {
  const rb = process.env[ROLLBACK_ENV];
  if (rb === "1" || rb === "true" || rb === "yes") return false;
  const v = process.env[FLAG_ENV];
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}
