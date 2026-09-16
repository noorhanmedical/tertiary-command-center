// Canonical Engagement call-list COHORTS.
//
// A cohort is NOT a stored membership list. It is a NAMED server-side query
// against the CURRENT canonical state (patient_execution_cases + outreach
// history), recomputed every time it is requested. Membership therefore
// changes automatically as the live spine changes:
//   • a patient who was "Never Called" yesterday but was called today no
//     longer matches "never_called";
//   • a patient who was "LVM" yesterday but was reached today no longer
//     matches "lvm".
//
// This module is the SINGLE SHARED SOURCE OF TRUTH for the cohort catalog so
// the client selector and the server query service can never drift. It is
// PURE (no DB, no server imports) so it is safe to import from either side and
// trivially unit-testable.
//
// The actual canonical SQL predicates live in
// server/services/engagement/callListCohortService.ts and are built ON TOP OF
// the existing shared eligibility predicates (dncExclusionCondition,
// activeEngagementStatusCondition, activeLifecycleCondition,
// noActivePatientClaimCondition, contactFrequencySuppressionCondition) so a
// cohort can never surface a patient the call list itself would suppress.

export const CALL_LIST_COHORT_KEYS = [
  "never_called",
  "lvm",
  "no_answer",
  "callback_due",
  "reached_not_scheduled",
  "scheduled",
  "refused",
  "scheduling_follow_up",
  "not_contacted_in_x_days",
  "unassigned_eligible",
  "due_today",
  "overdue",
  "new_qualified",
  "all_active_outreach",
] as const;

export type CallListCohortKey = (typeof CALL_LIST_COHORT_KEYS)[number];

export type CallListCohortDef = {
  key: CallListCohortKey;
  label: string;
  description: string;
  /** True when the cohort's definition depends on outreach-call history
   *  (used only for documentation / UI hints — the server owns the SQL). */
  usesOutreachHistory: boolean;
  /** True when the cohort exposes a manager-adjustable integer parameter
   *  (currently only "not_contacted_in_x_days"). */
  parameterized: boolean;
};

export const CALL_LIST_COHORTS: readonly CallListCohortDef[] = [
  {
    key: "never_called",
    label: "Never Called",
    description:
      "Active, eligible objective with no relevant outreach attempt yet.",
    usesOutreachHistory: true,
    parameterized: false,
  },
  {
    key: "lvm",
    label: "LVM",
    description: "Latest relevant outreach outcome was a voicemail.",
    usesOutreachHistory: true,
    parameterized: false,
  },
  {
    key: "no_answer",
    label: "No Answer",
    description: "Latest relevant outreach outcome was no answer.",
    usesOutreachHistory: true,
    parameterized: false,
  },
  {
    key: "callback_due",
    label: "Callback Due",
    description:
      "An explicit callback / next action is due now (clinic-local timing).",
    usesOutreachHistory: false,
    parameterized: false,
  },
  {
    key: "reached_not_scheduled",
    label: "Reached — Not Scheduled",
    description:
      "Patient was reached but the objective is still open (not yet scheduled).",
    usesOutreachHistory: true,
    parameterized: false,
  },
  {
    key: "scheduled",
    label: "Scheduled",
    description:
      "Objective has reached a booked/scheduled state (canonical scheduling state, not a UI string).",
    usesOutreachHistory: false,
    parameterized: false,
  },
  {
    key: "refused",
    label: "Refused",
    description:
      "Latest relevant outreach outcome is a refusal (declined / refused). Distinct from Do-Not-Contact.",
    usesOutreachHistory: true,
    parameterized: false,
  },
  {
    key: "scheduling_follow_up",
    label: "Scheduling Follow-Up",
    description: "Cases in the scheduling-triage bucket awaiting follow-up.",
    usesOutreachHistory: false,
    parameterized: false,
  },
  {
    key: "not_contacted_in_x_days",
    label: "Not Contacted in X Days",
    description:
      "No relevant outreach attempt within the configured lookback window.",
    usesOutreachHistory: true,
    parameterized: true,
  },
  {
    key: "unassigned_eligible",
    label: "Unassigned Eligible",
    description:
      "Active, callable case with no current owner (not DNC / terminal / scheduled).",
    usesOutreachHistory: false,
    parameterized: false,
  },
  {
    key: "due_today",
    label: "Due Today",
    description: "Next action falls within the clinic-local current day.",
    usesOutreachHistory: false,
    parameterized: false,
  },
  {
    key: "overdue",
    label: "Overdue",
    description: "Next action is past due per clinic-local date/time.",
    usesOutreachHistory: false,
    parameterized: false,
  },
  {
    key: "new_qualified",
    label: "New Qualified",
    description:
      "Newly qualified objective with no outreach attempt yet.",
    usesOutreachHistory: true,
    parameterized: false,
  },
  {
    key: "all_active_outreach",
    label: "All Active Outreach",
    description:
      "Every currently-callable objective after canonical exclusion + timing rules.",
    usesOutreachHistory: false,
    parameterized: false,
  },
] as const;

const COHORT_BY_KEY: Map<CallListCohortKey, CallListCohortDef> = new Map(
  CALL_LIST_COHORTS.map((c) => [c.key, c]),
);

export function isCallListCohortKey(v: unknown): v is CallListCohortKey {
  return typeof v === "string" && COHORT_BY_KEY.has(v as CallListCohortKey);
}

export function getCallListCohort(
  key: CallListCohortKey,
): CallListCohortDef {
  const def = COHORT_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown call-list cohort: ${key}`);
  return def;
}

// ─── "Not Contacted in X Days" parameter ────────────────────────────────────
// Default 7 (approved). Manager-adjustable; clamped to a sane range so a
// pasted/garbage value can never produce a runaway or negative window.
export const NOT_CONTACTED_DEFAULT_DAYS = 7;
export const NOT_CONTACTED_MIN_DAYS = 1;
export const NOT_CONTACTED_MAX_DAYS = 365;

/** Resolve + clamp the "Not Contacted in X Days" lookback. Non-integer / out
 *  of range / missing inputs collapse to the default. */
export function resolveNotContactedDays(input: unknown): number {
  // Missing / empty → default (Number(null)===0, Number("")===0 would
  // otherwise clamp to MIN rather than the intended default).
  if (input === null || input === undefined || input === "") {
    return NOT_CONTACTED_DEFAULT_DAYS;
  }
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n)) return NOT_CONTACTED_DEFAULT_DAYS;
  if (n < NOT_CONTACTED_MIN_DAYS) return NOT_CONTACTED_MIN_DAYS;
  if (n > NOT_CONTACTED_MAX_DAYS) return NOT_CONTACTED_MAX_DAYS;
  return n;
}
