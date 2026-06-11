// recordCallResult outreach delegation flag (Batch 17).
//
// DEFAULT: OFF. Distinct from the outreach preview flag (Batch H Step 3).

const FLAG_ENV = "USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE";

export function isRecordCallResultOutreachDelegateEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
