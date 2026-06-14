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
