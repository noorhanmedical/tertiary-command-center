// callAttemptRuntime — Phase 2 hardening item 1.
//
// Decides whether a given call-result outcome counts as an attempt,
// computes the new attempt count, and surfaces the unable-to-reach
// transition based on admin settings.
//
// Pure-ish: no DB calls from this module. The caller (the call-
// result route handler) passes:
//   - the current attempt count on the execution case
//   - the outcome
//   - the max_call_attempts setting
//
// The handler applies the resulting plan to the row inside its
// existing transaction-style update block.

/**
 * Outcomes that count as a call attempt — driven by what actually
 * gets dialed. Callback, DNC, declined, and scheduled all imply the
 * patient was reached or the case is being closed; they DO NOT
 * increment the attempt counter the way LVM / no_answer / wrong
 * number do.
 *
 * We intentionally include `voicemail`, `no_answer`, `wrong_number`,
 * `callback` because operationally each represents an actual dialing
 * action. `scheduled` / `declined` / `dnc` / `completed` represent
 * connections where the patient WAS reached, so they don't add to
 * the "couldn't reach" counter.
 */
export const ATTEMPT_INCREMENTING_OUTCOMES = new Set([
  "voicemail",
  "no_answer",
  "wrong_number",
  "callback",
]);

/**
 * Outcomes that immediately reset the attempt counter back to 0.
 * Reaching a patient closes the dialing campaign; if the case is
 * later re-opened the counter starts fresh.
 */
export const ATTEMPT_RESETTING_OUTCOMES = new Set([
  "scheduled",
  "completed",
  "declined",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
]);

export type CallAttemptInput = {
  currentAttemptCount: number;
  outcome: string;
  /** From the effective admin settings bundle. */
  maxCallAttempts: number;
  /** Now timestamp; injectable for tests. */
  now?: Date;
};

export type CallAttemptPlan = {
  /** The new attempt count to write to the execution case. */
  newAttemptCount: number;
  /** Whether this outcome counted as an attempt. */
  countedAsAttempt: boolean;
  /** When true, set last_attempt_at = now and last_call_outcome = outcome. */
  updateLastAttempt: boolean;
  /** When true, set unable_to_reach_at = now AND set engagementStatus = "unable_to_reach". */
  transitionToUnableToReach: boolean;
  /** The max attempt threshold used. Echoed for audit. */
  maxCallAttempts: number;
};

export function planCallAttempt(input: CallAttemptInput): CallAttemptPlan {
  const outcome = (input.outcome ?? "").toLowerCase();
  const counted = ATTEMPT_INCREMENTING_OUTCOMES.has(outcome);
  const resets = ATTEMPT_RESETTING_OUTCOMES.has(outcome);

  const newAttemptCount = resets
    ? 0
    : counted
      ? input.currentAttemptCount + 1
      : input.currentAttemptCount;

  // unable_to_reach fires only when the outcome counted AND the
  // threshold has been crossed. A "scheduled" outcome resets the
  // counter and would never trigger the transition.
  const transitionToUnableToReach =
    counted && newAttemptCount >= Math.max(1, input.maxCallAttempts);

  return {
    newAttemptCount,
    countedAsAttempt: counted,
    updateLastAttempt: counted,
    transitionToUnableToReach,
    maxCallAttempts: input.maxCallAttempts,
  };
}

// ─── Terminal-outcome + DNC classification (Phase 1B) ────────────────────────
//
// The canonical planner exposes a `terminal` boolean, but a boolean is
// meaningless unless the execution case actually becomes NON-CALLABLE. These
// pure predicates drive the real terminal execution-case state so a terminal
// disposition is excluded by BOTH eligibility paths:
//   • distribution allocator      (gatherEligibleCases)
//   • scheduler-portal call list   (buildSchedulerPortalConditions)
// The disposition REASON is never lost — it is preserved on
// patient_execution_cases.last_call_outcome (and the durable outreach_calls
// row). We do NOT invent policy for ambiguous long-tail outcomes: anything not
// listed here is left non-terminal (safe fallback).

// Refusal / do-not-contact family. `refused_dnc` is the UI/legacy value;
// `dnc` / `do_not_contact` are canonical synonyms. All three are the durable
// DNC signal (matches the patient-directory DNC derivation) and, because
// migration 0027's do_not_contact column is not universally applied, the
// outreach_calls row carrying one of these outcomes IS the durable fact.
export const DNC_OUTCOMES = new Set(["refused_dnc", "dnc", "do_not_contact"]);

// Negative terminal — patient will not be scheduled from this case; stop
// ordinary outbound calling. (declined already had terminal=true in the
// planner; the others include the refusal family + deceased/cancelled.)
export const NEGATIVE_TERMINAL_OUTCOMES = new Set([
  "declined",
  "refused_dnc",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
]);

// Positive terminal — the case reached a successful close via this disposition.
export const POSITIVE_TERMINAL_OUTCOMES = new Set(["completed"]);

// Scheduled — the case has LEFT the active call list via a booked/claimed
// appointment. It is NOT archive-terminal: the lifecycle stays "active" (the
// visit is still ahead) and the engagementStatus mirrors the canonical
// scheduling path (scheduleAncillaryCore sets engagementStatus="scheduled").
// A bare "scheduled" call disposition does NOT create an appointment row — the
// canonical scheduling route still owns that — but it MUST remove the case from
// ordinary outbound calling rather than leave it callable. Distinct disposition
// reason preserved on last_call_outcome. Excluded from BOTH eligibility reads
// via NON_CALLABLE_ENGAGEMENT_STATUSES (executionCase.repo.ts).
export const SCHEDULED_OUTCOME = "scheduled";

export type TerminalExecutionState = {
  engagementStatus: "closed" | "completed" | "scheduled";
  lifecycleStatus: "archived" | "completed" | "active";
};

/**
 * The NON-CALLABLE execution-case state a disposition writes, or null when the
 * outcome does not leave the active call list (ordinary + long-tail outcomes
 * are left untouched — no invented policy). Every non-null state here is
 * suppressed by BOTH eligibility reads (distribution allocator + scheduler-
 * portal call list) via the SHARED predicates in executionCase.repo.ts:
 *   • engagementStatus "closed" / "completed" / "scheduled"
 *       ∈ NON_CALLABLE_ENGAGEMENT_STATUSES → excluded by both reads
 *   • lifecycleStatus "archived" / "completed"
 *       → fails the shared active-lifecycle predicate (null|active) → excluded
 *   • lifecycleStatus "active" (scheduled) → still active, but the "scheduled"
 *       engagementStatus is what removes it from calling (distinct reason kept)
 * The DISPOSITION REASON is never lost — it is preserved on
 * patient_execution_cases.last_call_outcome and the durable outreach_calls row.
 */
export function resolveTerminalExecutionState(
  outcome: string,
): TerminalExecutionState | null {
  const o = (outcome ?? "").toLowerCase();
  if (NEGATIVE_TERMINAL_OUTCOMES.has(o)) {
    return { engagementStatus: "closed", lifecycleStatus: "archived" };
  }
  if (POSITIVE_TERMINAL_OUTCOMES.has(o)) {
    return { engagementStatus: "completed", lifecycleStatus: "completed" };
  }
  if (o === SCHEDULED_OUTCOME) {
    // Left the call list via scheduling; lifecycle remains active.
    return { engagementStatus: "scheduled", lifecycleStatus: "active" };
  }
  return null;
}

export function isDncOutcome(outcome: string): boolean {
  return DNC_OUTCOMES.has((outcome ?? "").toLowerCase());
}
