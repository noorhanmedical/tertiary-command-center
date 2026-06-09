// Operational-queue call-list read — env-flag accessor (Batch 11d).
//
// Same shape as bridge-flag.ts so the parity test can exercise the
// flag contract without touching the DB pool import chain. Zero
// runtime dependencies — only reads process.env.

const FLAG_ENV = "USE_OPERATIONAL_QUEUE_CALL_LIST";

/**
 * Reads `process.env[USE_OPERATIONAL_QUEUE_CALL_LIST]`. Truthy values
 * accepted: `"1"`, `"true"`, `"yes"`. Anything else (including unset)
 * keeps the call-list read on the legacy path.
 *
 * Flag-ON semantics (Batch 11d): the legacy handler still returns the
 * legacy SchedulerAssignment[] response. The operational-queue read is
 * called in parallel for ownerId-set parity comparison and emits a
 * structured PHI-safe log on mismatch. No response shape change.
 */
export function isOperationalQueueCallListEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
