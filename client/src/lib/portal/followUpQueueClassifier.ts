// Client-side mirror of server/services/operationalQueue/followUpQueueService.ts.
//
// The right-panel filter tabs need to count rows per tag without an
// extra round-trip. Both files use the same classification logic so
// counts stay consistent between Engagement Center (server side) and
// Team Portal (client side).

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
  engagementStatus?: string | null;
  lifecycleStatus?: string | null;
  qualificationStatus?: string | null;
  nextActionAt?: string | Date | null;
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

  if (engagement === "completed" || engagement === "closed" || lifecycle === "completed") {
    tags.add("completed");
    return [...tags];
  }
  if (lastOutcome === "dnc" || lastOutcome === "do_not_contact" || lastOutcome === "declined") {
    tags.add("dnc_or_declined");
  }
  if (lastOutcome === "voicemail") tags.add("lvm_follow_up");
  if (lastOutcome === "no_answer") tags.add("no_answer_follow_up");
  if (engagement === "needs_followup" && lastOutcome === "manager_review") {
    tags.add("manager_review");
  }
  if (
    engagement === "needs_followup" &&
    !tags.has("lvm_follow_up") &&
    !tags.has("no_answer_follow_up") &&
    !tags.has("manager_review")
  ) {
    tags.add("needs_follow_up");
  }
  const q = (row.qualificationStatus ?? "").toLowerCase();
  const qualifies = q === "qualified" || q === "auto_qualified";
  if (qualifies && (lastOutcome === "ready_to_schedule" || engagement === "ready_to_schedule")) {
    tags.add("ready_to_schedule");
  }
  if (nextAt && nextAt.getTime() <= now.getTime()) {
    tags.add("callbacks_due_now");
  }
  if (engagement === "unable_to_reach" || lifecycle === "unable_to_reach") {
    tags.add("unable_to_reach");
  }
  return [...tags];
}

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
    for (const tag of classifyFollowUpRow(r, now)) counts[tag]++;
  }
  return counts;
}

export const FOLLOW_UP_TAG_LABELS: Record<FollowUpFilterTag, string> = {
  callbacks_due_now: "Callbacks due now",
  lvm_follow_up: "LVM follow-up",
  no_answer_follow_up: "No-answer follow-up",
  ready_to_schedule: "Ready to schedule",
  needs_follow_up: "Needs follow-up",
  unable_to_reach: "Unable to reach",
  manager_review: "Manager review",
  dnc_or_declined: "DNC / declined",
  completed: "Completed",
};
