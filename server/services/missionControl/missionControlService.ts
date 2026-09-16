// Mission Control spine service — MONITORING ONLY, admin-only route.
//
// Layer contract:
//   route → auth (admin) → service → repository → bounded query
//
// This service:
//   • Never fabricates values.
//   • Uses the discriminated `MetricValue<T>` from the repo to decide
//     `sourceMissing` on the client shape. `sourceMissing` is true
//     ONLY when the authoritative source is unavailable. A valid
//     query that returns 0 stays `sourceMissing: false`.
//   • Injects `now` and the UTC date window into the repo — the repo
//     never calls `new Date()`.
//
// The Mission Control route is admin-only, so EVERY metric this
// service consumes is intentionally platform-wide. The client
// contract (client/src/hooks/api/missionControl.ts) carries no
// per-clinic filter today, so there is no "clinic-scoped Mission
// Control" surface for this service to feed. Every helper Mission
// Control uses is named with a `_platformWide` suffix in the repo
// to make that intent legible at each call site — no
// `{ clinicId: null }` construction here. If Mission Control ever
// gains a per-clinic view, the service will swap these for the
// clinic-scoped helpers directly.

import * as defaultRepo from "../../repositories/missionControl.repo";
import type { MetricValue } from "../../repositories/missionControl.repo";

// The set of repository helpers this service depends on. Every helper
// is platform-wide by design.
export type MissionRepoDeps = Pick<
  typeof defaultRepo,
  | "countActiveExecutionCases_platformWide"
  | "countCallbacksPending_platformWide"
  | "countOpenPlexusTasks_platformWide"
  | "countPrescreenPending_platformWide"
  | "countReadyForBilling_platformWide"
  | "countReportsMissing_platformWide"
  | "countRunningAnalysisJobs_platformWide"
  | "countScheduledInWindow_platformWide"
  | "countUpcomingAncillaryPatients_UNAVAILABLE"
>;

// Canonical Mission Control metric contract (MC-DATA-001). ONE per-field
// shape shared conceptually with client/src/hooks/api/missionControl.ts
// (MissionMetric). Availability is decided ONLY by the repository's
// discriminated `MetricValue.available` — never by `value === 0`. A real
// measured 0 is { value: 0, sourceMissing: false }; an unavailable source is
// { value: null, sourceMissing: true }. `0` is NEVER a stand-in for missing,
// and no metric's availability depends on a sibling's.
export type MetricUnit = "count" | "currency" | "percent" | "duration";

export type MissionMetric = {
  key: string;
  value: number | null;
  unit: MetricUnit;
  sourceMissing: boolean;
  reason?: string;
};

// Map a repository MetricValue → a MissionMetric. Available → real value
// (including 0); unavailable → null + the repo's reason.
function metric(
  key: string,
  m: MetricValue<number>,
  unit: MetricUnit = "count",
): MissionMetric {
  return m.available
    ? { key, value: m.value, unit, sourceMissing: false }
    : { key, value: null, unit, sourceMissing: true, reason: m.reason };
}

// A metric whose authoritative source is not wired yet. NEVER a 0 — the
// value is null so the UI renders an honest "—" rather than a fake zero.
function missingMetric(
  key: string,
  reason: string,
  unit: MetricUnit = "count",
): MissionMetric {
  return { key, value: null, unit, sourceMissing: true, reason };
}

export type MissionLaneStatus =
  | "Watch"
  | "Blocked"
  | "Ready"
  | "In Progress"
  | "Complete";
export type MissionPriority = "Urgent" | "High" | "Medium" | "Low";
export type MissionLaneKey =
  | "prescreen"
  | "ready-to-call"
  | "follow-up"
  | "callbacks"
  | "pending-ancillary"
  | "no-report"
  | "re-eligible"
  | "declined"
  | "billing-ready"
  | "blocked";

export interface MissionLaneRow {
  id: string;
  executionCaseId: number;
  patient: string;
  patientScreeningId: number | null;
  clinic: string;
  service: string;
  lane: MissionLaneKey;
  status: MissionLaneStatus;
  owner: string;
  team: string;
  nextAction: string;
  blocker: string | null;
  dueDate: string | null;
  priority: MissionPriority;
  callResult: string;
  callAttempts: number;
  lastContact: string | null;
  reportReadiness: string;
  billingReadiness: string;
}

const ROLE_DEFS: { role: string; label: string }[] = [
  { role: "scheduler", label: "Scheduler" },
  { role: "liaison", label: "Liaison" },
  { role: "technician", label: "Technician" },
  { role: "billing", label: "Billing" },
  { role: "manager", label: "Manager" },
];

// UTC helpers. The temporary canonical timezone policy is UTC — no
// clinic-timezone table exists on this platform. Every window
// boundary is a UTC midnight, so tests can pin `now` and compare
// exactly.
function utcDayStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function utcAddDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// buildMissionControlSpine accepts an optional injected clock. In prod
// callers pass nothing; tests pass a fixed Date so window boundaries
// are deterministic.
//
// The `clinicId` param is intentionally absent — Mission Control is
// admin-only, and platform-wide helpers are named as such. If a
// clinic-scoped Mission Control ever ships, this signature will
// change deliberately with an owner review.
export async function buildMissionControlSpine(
  opts: { now?: Date; repo?: MissionRepoDeps } = {},
) {
  const now = opts.now ?? new Date();
  const repo = opts.repo ?? (defaultRepo as MissionRepoDeps);
  const dayStart = utcDayStart(now);
  const dayEnd = utcAddDays(dayStart, 1);

  // Mission Control is admin-only + intentionally platform-wide. Every
  // repo call receives a `PlatformScope` phantom — this makes the
  // scope semantics explicit at the call site AND blocks a future
  // refactor from silently substituting `{ clinicId: null }` (which
  // would masquerade as clinic-scoped but drop the filter).
  const platformScope = { platformOnly: true as const };
  // The upcoming-ancillary metric is deferred — its dedupe helper
  // needs owner review before it can safely light up. Uses the
  // clinic-scope shape purely because the helper's signature was
  // written to be reusable; the scope value has no bearing on the
  // returned unavailability.
  const deferredScope = { clinicId: null };

  const [
    activeCases,
    openTasks,
    prescreen,
    callbacksPending,
    scheduledToday,
    readyForBilling,
    reportsMissing,
    qualificationBacklog,
    upcomingAncillary,
  ] = await Promise.all([
    repo.countActiveExecutionCases_platformWide(platformScope),
    repo.countOpenPlexusTasks_platformWide(platformScope),
    repo.countPrescreenPending_platformWide(platformScope),
    repo.countCallbacksPending_platformWide(platformScope, now),
    repo.countScheduledInWindow_platformWide(platformScope, {
      start: dayStart,
      end: dayEnd,
    }),
    repo.countReadyForBilling_platformWide(platformScope),
    repo.countReportsMissing_platformWide(platformScope),
    repo.countRunningAnalysisJobs_platformWide(platformScope),
    // Explicitly marked unavailable — NOT a proxy for active-case count.
    repo.countUpcomingAncillaryPatients_UNAVAILABLE(deferredScope),
  ]);

  const spine = {
    prescreen: metric("spine.prescreen", prescreen),
    // readyToCall / followUp / declined / re-eligible have no authoritative
    // single-table definition yet — honestly unavailable (value: null),
    // NOT a fake 0, until a scoped repo helper is authored (MC-DATA-003).
    readyToCall: missingMetric(
      "spine.readyToCall",
      "No scoped ready-to-call helper yet (MC-DATA-003).",
    ),
    followUp: missingMetric(
      "spine.followUp",
      "No scoped follow-up helper yet (MC-DATA-003).",
    ),
    callbacks: metric("spine.callbacks", callbacksPending),
    // upcomingAncillary is explicitly UNAVAILABLE from the repo → null.
    pending: metric("spine.pending", upcomingAncillary),
    noReport: metric("spine.noReport", reportsMissing),
    reEligible: missingMetric(
      "spine.reEligible",
      "No authoritative re-eligible source yet.",
    ),
    declined: missingMetric(
      "spine.declined",
      "No scoped declined helper yet (MC-DATA-003).",
    ),
    readyForBilling: metric("spine.readyForBilling", readyForBilling),
    tasks: metric("spine.tasks", openTasks),
  };

  const roleQueues = ROLE_DEFS.map(({ role, label }) => ({
    role,
    label,
    total: 0,
    urgent: 0,
    blocked: 0,
    ready: 0,
    // Role queue aggregation needs a JOIN across execution_cases +
    // outreach_schedulers + role_assignments. Kept sourceMissing.
    sourceMissing: true,
  }));

  return {
    generatedAt: now.toISOString(),
    spine,
    lanes: [] as MissionLaneRow[],
    clinics: [] as string[],
    owners: [] as string[],
    roleQueues,
    // Per-field metric contract (MC-DATA-001). NO section-level sourceMissing:
    // each metric carries its own availability, so a live metric (e.g.
    // inPipeline, tasksOpen, billingReady) is NEVER blanked by an unavailable
    // sibling. Not-yet-wired metrics are honest `missingMetric` (value: null),
    // NOT a fake 0.
    sections: {
      calls: {
        // madeToday / reachedToday / madeLast7 need a scoped date-window
        // count on outreach_calls.started_at + outcome (MC-DATA-003).
        madeToday: missingMetric(
          "calls.madeToday",
          "outreach_calls window count not wired yet (MC-DATA-003).",
        ),
        reachedToday: missingMetric(
          "calls.reachedToday",
          "reached-outcome window count not wired yet (MC-DATA-003).",
        ),
        callbacksPending: metric("calls.callbacksPending", callbacksPending),
        madeLast7: missingMetric(
          "calls.madeLast7",
          "outreach_calls 7d count not wired yet (MC-DATA-003).",
        ),
      },
      patientServices: {
        // inPipeline = execution cases actively in the pipeline (live).
        inPipeline: metric("patientServices.inPipeline", activeCases),
        prescreenBacklog: metric("patientServices.prescreenBacklog", prescreen),
        pendingAncillary: metric("patientServices.pendingAncillary", upcomingAncillary),
        declinedLast7: missingMetric(
          "patientServices.declinedLast7",
          "declined-outcome 7d count not wired yet (MC-DATA-003).",
        ),
      },
      finance: {
        billingReady: metric("finance.billingReady", readyForBilling),
        invoicesSubmitted: missingMetric(
          "finance.invoicesSubmitted",
          "invoice submission count not wired yet (MC-DATA-007).",
        ),
        paidAmount: missingMetric(
          "finance.paidAmount",
          "collections source not wired yet (MC-DATA-007).",
          "currency",
        ),
        outstandingBalance: missingMetric(
          "finance.outstandingBalance",
          "AR source not wired yet (MC-DATA-007).",
          "currency",
        ),
      },
      operations: {
        tasksOpen: metric("operations.tasksOpen", openTasks),
        tasksOverdue: missingMetric(
          "operations.tasksOverdue",
          "overdue-task predicate not wired yet (MC-DATA-006).",
        ),
        tasksHighPriority: missingMetric(
          "operations.tasksHighPriority",
          "high-priority predicate not wired yet (MC-DATA-006).",
        ),
      },
      ancillaryToday: {
        scheduledToday: metric("ancillaryToday.scheduledToday", scheduledToday),
        completedToday: missingMetric(
          "ancillaryToday.completedToday",
          "procedure completion count not wired yet (MC-DATA-004).",
        ),
        cancelledToday: missingMetric(
          "ancillaryToday.cancelledToday",
          "cancellation count not wired yet (MC-DATA-004).",
        ),
      },
      // Non-client-contract server extra. Ignored by the client type; safe.
      qualification: {
        backlog: metric("qualification.backlog", qualificationBacklog),
      },
    },
    ringCentral: { connected: false as const },
  };
}
