// Engagement → call-list bridge — env-flag accessor (Batch 11c).
//
// Extracted from bridge.ts so the flag contract is testable without
// pulling in the DB pool import chain. This module has ZERO runtime
// dependencies — it only reads process.env.

const FLAG_ENV = "ENGAGEMENT_TO_CALL_LIST_BRIDGE";

/**
 * Reads `process.env[ENGAGEMENT_TO_CALL_LIST_BRIDGE]`. Truthy values
 * accepted: `"1"`, `"true"`, `"yes"`. Anything else (including unset)
 * disables the bridge.
 */
export function isEngagementToCallListBridgeEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
