// followUpQueueService — Phase 2 PR 2.3.
//
// Classifies a workspace call-list row into one of the operational
// queue filters used by the Engagement Center + Team Portal right
// panel.
//
// Pure: takes a row + the current Date, returns a tag (or array of
// tags). No DB access. The row is the canonical projection from
// listSchedulerPortalCases — same shape as the workspace call list
// helper consumes.
//
// We intentionally classify into MULTIPLE tags when applicable
// (e.g. a "ready_to_schedule" row may also be "callback_due_now")
// so the UI can highlight rows under whichever tab is open. The
// "no fake queue membership" rule means a row's tag is always
// derived from real columns, never from setTimeout / setState.

export type FollowUpFilterTag =
  | "callbacks_due_now"
  | "lvm_follow_up"
  | "no_answer_follow_up"
  | "ready_to_schedule"
  | "needs_follow_up"
  | "unable_to_reach"
  | "manager_review"
  | "dnc_or_declined"
  | "completed";

export type FollowUpRowProjection = {
  /** Most recent recorded call disposition or engagement status. */
  engagementStatus?: string | null;
  lifecycleStatus?: string | null;
  qualificationStatus?: string | null;
  /** When the row needs the next action. */
  nextActionAt?: string | Date | null;
  /** Last logged call outcome label (e.g. "voicemail" / "no_answer"). */
  lastCallOutcome?: string | null;
};

function asDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function classifyFollowUpRow(
  row: FollowUpRowProjection,
  now: Date = new Date(),
): FollowUpFilterTag[] {
  const tags = new Set<FollowUpFilterTag>();

  const lifecycle = (row.lifecycleStatus ?? "").toLowerCase();
  const engagement = (row.engagementStatus ?? "").toLowerCase();
  const lastOutcome = (row.lastCallOutcome ?? "").toLowerCase();
  const nextAt = asDate(row.nextActionAt ?? null);

  // Completed.
  if (engagement === "completed" || engagement === "closed" || lifecycle === "completed") {
    tags.add("completed");
    return [...tags];
  }

  // DNC / declined — surfaced under one combined filter.
  if (lastOutcome === "dnc" || lastOutcome === "do_not_contact" || lastOutcome === "declined") {
    tags.add("dnc_or_declined");
  }

  // LVM follow-up — last outcome was a voicemail and nextActionAt is set.
  if (lastOutcome === "voicemail") {
    tags.add("lvm_follow_up");
  }
  // No-answer follow-up.
  if (lastOutcome === "no_answer") {
    tags.add("no_answer_follow_up");
  }
  // Manager review.
  if (engagement === "needs_followup" && lastOutcome === "manager_review") {
    tags.add("manager_review");
  }
  // Needs follow-up — generic catch-all when engagement says so but
  // no more specific tag applies.
  if (
    engagement === "needs_followup" &&
    !tags.has("lvm_follow_up") &&
    !tags.has("no_answer_follow_up") &&
    !tags.has("manager_review")
  ) {
    tags.add("needs_follow_up");
  }

  // Ready to schedule.
  if (qualifies(row) && (lastOutcome === "ready_to_schedule" || engagement === "ready_to_schedule")) {
    tags.add("ready_to_schedule");
  }

  // Callbacks due now — nextActionAt has elapsed.
  if (nextAt && nextAt.getTime() <= now.getTime()) {
    tags.add("callbacks_due_now");
  }

  // Unable to reach (terminal-style; surfaced as its own filter).
  if (engagement === "unable_to_reach" || lifecycle === "unable_to_reach") {
    tags.add("unable_to_reach");
  }

  return [...tags];
}

function qualifies(row: FollowUpRowProjection): boolean {
  const q = (row.qualificationStatus ?? "").toLowerCase();
  return q === "qualified" || q === "auto_qualified";
}

/** Aggregate counts per tag for a list of rows. */
export function countFollowUpTags(
  rows: FollowUpRowProjection[],
  now: Date = new Date(),
): Record<FollowUpFilterTag, number> {
  const counts: Record<FollowUpFilterTag, number> = {
    callbacks_due_now: 0,
    lvm_follow_up: 0,
    no_answer_follow_up: 0,
    ready_to_schedule: 0,
    needs_follow_up: 0,
    unable_to_reach: 0,
    manager_review: 0,
    dnc_or_declined: 0,
    completed: 0,
  };
  for (const r of rows) {
    for (const tag of classifyFollowUpRow(r, now)) {
      counts[tag]++;
    }
  }
  return counts;
}
