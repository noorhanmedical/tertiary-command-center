// Outreach call-result response shape — fixture (Batch 15).
//
// POST /api/outreach/calls returns res.status(201).json(call). The
// response body is the raw outreach_calls row (no wrapper envelope).
// Future outreach delegation MUST preserve this — no wrapper, no
// added keys, no removed keys, no nullability changes.
//
// Data-only fixture. No PHI.

/**
 * The shape pin: the response is the raw `outreach_calls` row.
 * This fixture documents that contract; the row's columns are
 * defined in shared/schema/outreach.ts. We DO NOT enumerate columns
 * here — adding a column to the underlying table is a separate
 * approved migration and would update the row, not this fixture.
 */
export const OUTREACH_CALL_RESULT_RESPONSE_CONTRACT = {
  httpStatus: 201,
  envelope: "raw_row" as const,
  /** No wrapper key. Direct row body. */
  wrapperKey: null as null,
  /** The shape is the outreach_calls row as inserted by storage.createOutreachCallAtomic. */
  source: "outreach_calls row",
} as const;

/**
 * Outcomes the outreach route accepts beyond the canonical-10 — these
 * are the outreach-only outcomes (wants_more_info, language_barrier,
 * mailbox_full, hung_up, disconnected, busy, reached, refused_dnc,
 * moved, deceased, not_interested, will_think_about_it). Listed here
 * for future delegation work to know which outcomes need fixture
 * extension.
 */
export const OUTREACH_ONLY_OUTCOMES = [
  "wants_more_info",
  "language_barrier",
  "mailbox_full",
  "hung_up",
  "disconnected",
  "busy",
  "reached",
  "refused_dnc",
  "moved",
  "deceased",
  "not_interested",
  "will_think_about_it",
] as const;

// Import-time sanity check.
{
  if (OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.httpStatus !== 201) {
    throw new Error("outreach response shape: HTTP status must be 201");
  }
  if (OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.envelope !== "raw_row") {
    throw new Error("outreach response shape: envelope must be raw_row");
  }
  if (OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.wrapperKey !== null) {
    throw new Error("outreach response shape: wrapperKey must be null");
  }
  const seen = new Set<string>();
  for (const o of OUTREACH_ONLY_OUTCOMES) {
    if (seen.has(o)) throw new Error(`outreach-only outcomes: duplicate "${o}"`);
    seen.add(o);
  }
}
