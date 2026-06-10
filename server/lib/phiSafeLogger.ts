// PHI-safe logger contract (Bundle 8).
//
// Additive helper. NOT wired to any call site in this PR. The
// existing console.log/console.error/console.warn sites continue to
// run unchanged. Adopting this helper is a per-site opt-in handled by
// later bundles (one site at a time, with explicit review).
//
// Why this exists:
//   The PHI-safe-logging rule (no patient names, DOBs, insurance IDs,
//   raw billing payloads, claim/payment/remittance details, raw query
//   strings, or metadata bodies in logs) is enforced today by QA
//   scripts that scan source files for forbidden strings. That's
//   reactive — a new site can leak PHI before the QA invariant is
//   tightened.
//
//   This module gives future call sites a typed entrypoint that makes
//   PHI leakage hard to commit accidentally: the helper accepts ONLY
//   the documented payload shape (counts, booleans, IDs, enum
//   literals). String fields are typed as `LogSafeTag` which is a
//   literal-string union derived from the contract — passing a raw
//   patient name would fail TypeScript.
//
// Cross-reference:
//   - docs/architecture/protected-flows.md (PHI-safe logging rules)
//   - docs/architecture/do-not-touch.md
//   - server/lib/advisoryLock.ts (same lib/ folder pattern)

/**
 * Allowed string-shaped fields. Each value must be a documented
 * non-PHI tag — event-type literal, event-source enum, kind, status,
 * flag name. Anything outside this set is rejected at the type level.
 *
 * Add new tags here only after confirming the value can never carry
 * patient-identifying information.
 */
export type LogSafeTag =
  // Event-source literals from journey-event call sites.
  | "engagement_assignment_board"
  | "scheduler_portal"
  | "plexus_tasks"
  | "scheduler_auto_assign"
  | "document_library"
  | "document_complete_action"
  | "auto_commit"
  | "manual_commit"
  | "screening_commit_hook"
  | "ensure_canonical_spine"
  // Flag names + module identifiers.
  | "ENGAGEMENT_TO_CALL_LIST_BRIDGE"
  | "USE_OPERATIONAL_QUEUE_CALL_LIST"
  | "operational-queue"
  | "engagement-board"
  | "patient-packet"
  // Outcome enums from helper return shapes.
  | "disabled"
  | "skipped"
  | "created"
  | "already_active"
  | "ok"
  | "failed"
  | "validation_failed"
  | "db_failed"
  | "missing_row";

/**
 * Allowed log payload shape. Only structural fields — never strings
 * outside `LogSafeTag`. Numbers / booleans / null are always OK.
 */
export type LogSafePayload = {
  source: LogSafeTag;
  outcome?: LogSafeTag;
  // Numeric counts — the typical safe metric.
  count?: number;
  legacyCount?: number;
  queueCount?: number;
  inLegacyOnly?: number;
  inQueueOnly?: number;
  total?: number;
  failed?: number;
  // IDs are integers (patient_screenings.id, scheduler_assignments.id,
  // etc.). They are NOT PHI on their own; the DB row they reference
  // contains PHI but the integer key does not.
  ownerId?: number;
  patientScreeningId?: number;
  executionCaseId?: number;
  schedulerId?: number;
  // Booleans.
  parityMatch?: boolean;
  enabled?: boolean;
  cached?: boolean;
};

/**
 * Emit a PHI-safe info log line. Use for shadow-read parity checks,
 * background-job heartbeats, flag-state transitions.
 *
 * Adoption is OPT-IN. Existing console.log sites are not changed.
 */
export function logPhiSafe(payload: LogSafePayload): void {
  console.log(`[${payload.source}]`, sanitize(payload));
}

/**
 * Emit a PHI-safe warning. Use when something looks off but the
 * caller continues (e.g., unknown event-type literal, missing row in
 * a projection).
 */
export function warnPhiSafe(payload: LogSafePayload): void {
  console.warn(`[${payload.source}]`, sanitize(payload));
}

/**
 * Emit a PHI-safe error. Use for caught exceptions where the caller
 * swallowed the failure (best-effort sites). Pass the error message
 * via `outcome: "failed"` and the caught error stays in the caller's
 * own console.error call.
 */
export function errorPhiSafe(payload: LogSafePayload): void {
  console.error(`[${payload.source}]`, sanitize(payload));
}

function sanitize(payload: LogSafePayload): Record<string, unknown> {
  // Strip the source tag since it's already in the bracketed prefix.
  const { source: _src, ...rest } = payload;
  return rest;
}
