// Shared next-action-at policy for the call-list engine.
//
// Single source of truth for "when should this case next surface on a call
// list" used by BOTH the engagement assignment path and (optionally) the
// call-result path. Keeping the policy here means assignment and disposition
// agree on the same retry/callback windows instead of each re-deriving them.
//
// See docs/architecture/call-list-engine-architecture.md §"next_action_at policy".

export type NextActionBucket =
  | "now" // surface immediately (fresh assignment, no prior disposition)
  | "callback" // patient-requested callback at a specific/derived time
  | "retry" // no-answer / voicemail re-queue after a retry window
  | "scheduled" // appointment booked — leaves the active call list
  | "inactive" // terminal (declined / completed / wrong number w/o alt) — no next action
  | "admin_review"; // removed from the normal call list, flagged for admin

export type CalculateNextActionInput = {
  /** Raw call-result outcome string. Omit (or pass null) for a fresh assignment. */
  outcome?: string | null;
  /** True when invoked from the assignment path (no disposition yet). */
  isAssignment?: boolean;
  /** Caller-supplied explicit next-action timestamp — wins over derived timing. */
  explicitNextActionAt?: string | Date | null;
  /** Injection point for deterministic testing; defaults to new Date(). */
  now?: Date;
  /** scheduling_triage.default_callback_due_hours (default 24). */
  callbackHours?: number;
  /** engagement_center.no_answer_callback_hours (default 4). */
  noAnswerHours?: number;
  /** engagement_center.voicemail_callback_hours (default 4). */
  voicemailHours?: number;
  /** wrong_number only — when an alternate number exists we re-queue instead of closing. */
  hasAlternateNumber?: boolean;
};

export type NextActionResult = {
  nextActionAt: Date | null;
  bucket: NextActionBucket;
};

const DEFAULT_CALLBACK_HOURS = 24;
const DEFAULT_NO_ANSWER_HOURS = 4;
const DEFAULT_VOICEMAIL_HOURS = 4;

function parseExplicit(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function addHours(base: Date, hours: number): Date {
  const dt = new Date(base.getTime());
  dt.setHours(dt.getHours() + hours);
  return dt;
}

/**
 * Resolve the call-list next-action policy for an assignment or a call result.
 *
 * Policy (per Option 2 spec §4):
 *   assignment (no disposition)          → bucket "now",  next = now
 *   callback / call-later requested      → bucket "callback", next = explicit OR now+callbackHours
 *   no_answer                            → bucket "retry", next = now + noAnswerHours
 *   voicemail (LVM)                      → bucket "retry", next = now + voicemailHours
 *   wrong_number (no alt number)         → bucket "inactive", next = null
 *   wrong_number (alt number present)    → bucket "retry", next = now
 *   declined / completed / cancelled /
 *     no_show                            → bucket "inactive", next = null
 *   scheduled                            → bucket "scheduled", next = null (appointment workflow owns it)
 *   needs_admin_review / manager_review /
 *     needs_records                      → bucket "admin_review", next = null (off the normal list)
 *   anything else                        → bucket "now", next = now
 *
 * An explicit `explicitNextActionAt` always overrides the derived timestamp
 * for the active buckets (now / callback / retry); terminal/scheduled/
 * admin_review buckets stay null regardless.
 */
export function calculateNextActionAt(
  input: CalculateNextActionInput,
): NextActionResult {
  const now = input.now ?? new Date();
  const callbackHours = input.callbackHours ?? DEFAULT_CALLBACK_HOURS;
  const noAnswerHours = input.noAnswerHours ?? DEFAULT_NO_ANSWER_HOURS;
  const voicemailHours = input.voicemailHours ?? DEFAULT_VOICEMAIL_HOURS;
  const explicit = parseExplicit(input.explicitNextActionAt);

  const outcome = (input.outcome ?? "").trim().toLowerCase();

  // Fresh assignment with no disposition → surface immediately.
  if (input.isAssignment || outcome === "" || outcome === "assignment") {
    return { nextActionAt: explicit ?? now, bucket: "now" };
  }

  switch (outcome) {
    case "callback":
    case "patient_requested_call_later":
      return {
        nextActionAt: explicit ?? addHours(now, callbackHours),
        bucket: "callback",
      };
    case "no_answer":
      return {
        nextActionAt: explicit ?? addHours(now, noAnswerHours),
        bucket: "retry",
      };
    case "voicemail":
      return {
        nextActionAt: explicit ?? addHours(now, voicemailHours),
        bucket: "retry",
      };
    case "wrong_number":
      return input.hasAlternateNumber
        ? { nextActionAt: explicit ?? now, bucket: "retry" }
        : { nextActionAt: null, bucket: "inactive" };
    case "declined":
    case "completed":
    case "cancelled":
    case "no_show":
      return { nextActionAt: null, bucket: "inactive" };
    case "scheduled":
      return { nextActionAt: null, bucket: "scheduled" };
    case "needs_admin_review":
    case "manager_review":
    case "needs_records":
      return { nextActionAt: null, bucket: "admin_review" };
    default:
      return { nextActionAt: explicit ?? now, bucket: "now" };
  }
}
