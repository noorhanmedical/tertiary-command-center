// Team Metrics — pure disposition mapping.
//
// Zero I/O, zero DB, zero drizzle imports. Every call-outcome → disposition
// category rule lives here so the /api/engagement/team-metrics rollup and
// the /api/engagement/baskets read-model share ONE source of truth and can
// be unit-tested without a DB connection.
//
// Also re-exported from teamMetricsService.ts so downstream code keeps a
// single import path.

export const DISPOSITION_CATEGORIES = [
  "scheduled",
  "completed",
  "noAnswer",
  "voicemail",
  "declined",
  "followUp",
  "other",
] as const;

export type DispositionCategory = (typeof DISPOSITION_CATEGORIES)[number];

export type DispositionBreakdown = Record<DispositionCategory, number>;

const OUTCOME_TO_DISPOSITION: Record<string, DispositionCategory> = {
  // Positive terminal — patient is booked / served.
  scheduled: "scheduled",
  completed: "scheduled",
  // Live conversation that did not (yet) terminate positively.
  reached: "completed",
  // No live contact.
  no_answer: "noAnswer",
  busy: "noAnswer",
  hung_up: "noAnswer",
  disconnected: "noAnswer",
  mailbox_full: "noAnswer",
  voicemail: "voicemail",
  // Negative terminal.
  declined: "declined",
  not_interested: "declined",
  refused_dnc: "declined",
  dnc: "declined",
  do_not_contact: "declined",
  wrong_number: "declined",
  moved: "declined",
  deceased: "declined",
  cancelled: "declined",
  language_barrier: "declined",
  // Needs another touch / follow-up work.
  callback: "followUp",
  wants_more_info: "followUp",
  will_think_about_it: "followUp",
  needs_records: "followUp",
  insurance_prior_auth_issue: "followUp",
  manager_review: "followUp",
  facility_specific_issue: "followUp",
};

/** Pure: map a raw call outcome string to its disposition category. */
export function mapOutcomeToDisposition(outcome: string): DispositionCategory {
  return OUTCOME_TO_DISPOSITION[outcome] ?? "other";
}

/** Pure: extract the logged outcome from a call_result_logged journey
 *  event's metadata bag. Both the legacy and canonical call-result paths
 *  persist the raw outcome under `callResult`; we fall back to a couple
 *  of aliases so a metadata-shape change can't silently drop the call.
 *  Returns null when no outcome is recorded. */
export function outcomeFromJourneyMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const raw = m.callResult ?? m.callDisposition ?? m.outcome;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/** Pure: an all-zero disposition breakdown. */
export function emptyDispositionBreakdown(): DispositionBreakdown {
  return {
    scheduled: 0,
    completed: 0,
    noAnswer: 0,
    voicemail: 0,
    declined: 0,
    followUp: 0,
    other: 0,
  };
}
