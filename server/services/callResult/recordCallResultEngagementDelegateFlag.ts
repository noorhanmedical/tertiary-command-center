// recordCallResult engagement-center delegation flag (Batch 10).
//
// DEFAULT: OFF. Distinct from the preview flag (Batch H Step 2).
//
// Truthy values: "1" / "true" / "yes". The accessor is intentionally
// minimal — no DB, no Express, no other imports. The Batch 12
// engagement route delegation will be the FIRST caller; until then
// this accessor is read by no runtime code (callable by tests only).
//
// REFERENCED CONTRACTS
//   - docs/architecture/engagement-canonical-call-result-endpoint-contract.md (Batch 6)
//   - docs/architecture/call-result-engagement-delegation-contract.md (this batch)

const FLAG_ENV = "USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE";

export function isRecordCallResultEngagementDelegateEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
