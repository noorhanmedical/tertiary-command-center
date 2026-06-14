// applyCallResultRouting — Phase 2 PR 2.2.
//
// Wraps the call-result lifecycle so all routing decisions are
// driven by the effective admin settings bundle, not hardcoded
// route-level constants. Pulls the bundle once per call and returns
// a structured RoutingPlan that the route handler applies.
//
// The route handler in server/routes/executionCases.ts still owns
// the actual DB writes (journey events, triage cases, plexus tasks,
// execution-case updates) — this service just decides what the
// plan should be, given the outcome + settings + caller context.
//
// Pure-ish: takes only the effective bundle + the outcome + a
// callbackAt override. No DB access from here; the bundle is loaded
// upstream so the same instance can be passed to peer services.

import type { EffectiveAdminSettingsBundle } from "../adminSettings/adminSettingsEffectiveService";

export type CallResultRoutingInput = {
  outcome: string;
  /** Operator-supplied callback time in ISO. Wins over the
   *  admin-settings-derived default for callback-style outcomes. */
  explicitCallbackAt: string | null;
  /** Current attempt count on the execution case (PR 2.2 reads it
   *  so unable-to-reach can trigger at max_call_attempts). */
  currentAttemptCount: number;
};

export type CallResultRoutingPlan = {
  outcome: string;
  /** Whether this outcome closes the assignment (terminal-positive
   *  / terminal-negative). */
  terminal: boolean;
  /** The nextActionAt the route handler should set on the execution
   *  case, or null when no next action is required. */
  nextActionAt: Date | null;
  /** Open a scheduling_triage_cases row. */
  openTriageCase: boolean;
  /** Open a plexus_tasks row. */
  openFollowUpTask: boolean;
  /** Why the nextActionAt was set (or null when none). Used in
   *  logging / debugging. */
  nextActionReason:
    | "explicit_callback_at"
    | "callback_default"
    | "no_answer_default"
    | "voicemail_default"
    | null;
  /** PR 2.2 — When true, the case has hit max_call_attempts and
   *  the route should transition it to unable_to_reach. */
  shouldTransitionToUnableToReach: boolean;
  /** PR 2.2 — auditing the routing decision so QA can trace which
   *  settings won. */
  appliedSettings: {
    callbackDueHours: number;
    noAnswerCallbackHours: number;
    voicemailCallbackHours: number;
    maxCallAttempts: number;
    dncIsTerminal: boolean;
    declinedIsTerminal: boolean;
    readyToScheduleRoutesToTriage: boolean;
    scheduledClosesAssignment: boolean;
    queueReentryEnabled: boolean;
  };
};

const TERMINAL_FIXED = new Set([
  "completed", "deceased", "cancelled", "do_not_contact",
]);

export function applyCallResultRouting(
  input: CallResultRoutingInput,
  bundle: EffectiveAdminSettingsBundle,
): CallResultRoutingPlan {
  const cr = bundle.callResult;

  let nextActionAt: Date | null = null;
  let nextActionReason: CallResultRoutingPlan["nextActionReason"] = null;
  if (input.explicitCallbackAt) {
    const dt = new Date(input.explicitCallbackAt);
    if (!Number.isNaN(dt.getTime())) {
      nextActionAt = dt;
      nextActionReason = "explicit_callback_at";
    }
  }
  if (!nextActionAt && cr.queueReentryEnabled) {
    const now = new Date();
    if (input.outcome === "callback" || input.outcome === "patient_requested_call_later") {
      nextActionAt = new Date(now.getTime() + cr.callbackDueHours * 3600_000);
      nextActionReason = "callback_default";
    } else if (input.outcome === "no_answer") {
      nextActionAt = new Date(now.getTime() + cr.noAnswerCallbackHours * 3600_000);
      nextActionReason = "no_answer_default";
    } else if (input.outcome === "voicemail") {
      nextActionAt = new Date(now.getTime() + cr.voicemailCallbackHours * 3600_000);
      nextActionReason = "voicemail_default";
    }
  }

  // Terminal classification.
  let terminal = false;
  if (input.outcome === "scheduled") {
    terminal = cr.scheduledClosesAssignment;
  } else if (input.outcome === "dnc") {
    terminal = cr.dncIsTerminal;
  } else if (input.outcome === "declined") {
    terminal = cr.declinedIsTerminal;
  } else if (TERMINAL_FIXED.has(input.outcome)) {
    terminal = true;
  }

  // Triage routing.
  const TRIAGE_OUTCOMES = new Set([
    "callback", "no_answer", "voicemail", "wrong_number", "cancelled",
    "no_show", "needs_new_date", "patient_requested_call_later",
    "reschedule", "transportation_issue",
  ]);
  let openTriageCase = TRIAGE_OUTCOMES.has(input.outcome);
  if (input.outcome === "ready_to_schedule") {
    openTriageCase = cr.readyToScheduleRoutesToTriage;
  }

  const TASK_OUTCOMES = new Set([
    "needs_records",
    "insurance_prior_auth_issue",
    "facility_specific_issue",
    "technician_unavailable",
  ]);
  let openFollowUpTask = TASK_OUTCOMES.has(input.outcome);
  if (input.outcome === "manager_review") {
    openFollowUpTask = cr.managerReviewRequiresTask;
  }

  const shouldTransitionToUnableToReach =
    (input.outcome === "no_answer" || input.outcome === "voicemail") &&
    input.currentAttemptCount + 1 >= cr.maxCallAttempts;

  return {
    outcome: input.outcome,
    terminal,
    nextActionAt,
    nextActionReason,
    openTriageCase,
    openFollowUpTask,
    shouldTransitionToUnableToReach,
    appliedSettings: {
      callbackDueHours: cr.callbackDueHours,
      noAnswerCallbackHours: cr.noAnswerCallbackHours,
      voicemailCallbackHours: cr.voicemailCallbackHours,
      maxCallAttempts: cr.maxCallAttempts,
      dncIsTerminal: cr.dncIsTerminal,
      declinedIsTerminal: cr.declinedIsTerminal,
      readyToScheduleRoutesToTriage: cr.readyToScheduleRoutesToTriage,
      scheduledClosesAssignment: cr.scheduledClosesAssignment,
      queueReentryEnabled: cr.queueReentryEnabled,
    },
  };
}
