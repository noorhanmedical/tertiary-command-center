// Portal call-history read flag — env-flag accessor (Batch I).
//
// Pure module. ZERO runtime dependencies — only reads process.env.
// Mirrors the operational-queue/call-list-flag.ts pattern (Bundle 14)
// so the flag contract is testable without pulling in the DB pool.

const FLAG_ENV = "USE_PORTAL_CALL_HISTORY_READ";

/**
 * Reads `process.env[USE_PORTAL_CALL_HISTORY_READ]`. Truthy values
 * accepted: `"1"`, `"true"`, `"yes"`. Anything else (including unset)
 * disables the route — the route returns 404 in that case.
 *
 * Default is DISABLED. A future production-flip PR may flip the
 * default after the §7 staging gate in
 * docs/architecture/call-list-runtime-implementation-plan.md.
 */
export function isPortalCallHistoryReadEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}
