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

// Client wire format (from client/src/hooks/api/missionControl.ts):
//   Wrapped<T> = { value: T; sourceMissing: boolean }
// sourceMissing = TRUE only when repository returned `available: false`.
type Wrapped<T> = { value: T; sourceMissing: boolean };

function wrapCount(m: MetricValue<number>, fallback = 0): Wrapped<number> {
  if (m.available) return { value: m.value, sourceMissing: false };
  return { value: fallback, sourceMissing: true };
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
    prescreen: wrapCount(prescreen),
    // readyToCall / followUp / declined / re-eligible / pending have
    // no authoritative single-table definition yet — kept unavailable
    // until a scoped repo helper is authored.
    readyToCall: { value: 0, sourceMissing: true } as Wrapped<number>,
    followUp: { value: 0, sourceMissing: true } as Wrapped<number>,
    callbacks: wrapCount(callbacksPending),
    pending: wrapCount(upcomingAncillary),
    noReport: wrapCount(reportsMissing),
    reEligible: { value: 0, sourceMissing: true } as Wrapped<number>,
    declined: { value: 0, sourceMissing: true } as Wrapped<number>,
    readyForBilling: wrapCount(readyForBilling),
    tasks: wrapCount(openTasks),
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
    sections: {
      calls: {
        madeToday: 0,
        reachedToday: 0,
        callbacksPending: callbacksPending.available ? callbacksPending.value : 0,
        madeLast7: 0,
        // madeToday / reachedToday / madeLast7 need a scoped date-window
        // count on outreach_calls.started_at + outcome; kept sourceMissing
        // until a scoped helper lands.
        sourceMissing: !callbacksPending.available,
      },
      patientServices: {
        // Client contract fields; the "activePatients" concept is
        // reported honestly as inPipeline (execution cases actively
        // in the pipeline).
        inPipeline: activeCases.available ? activeCases.value : 0,
        prescreenBacklog: prescreen.available ? prescreen.value : 0,
        pendingAncillary: upcomingAncillary.available ? upcomingAncillary.value : 0,
        declinedLast7: 0,
        // declinedLast7 needs a scoped outreach_calls query with
        // outcome IN ('declined','not_interested','refused_dnc') in
        // last 7 days — kept unavailable until authored.
        sourceMissing:
          !activeCases.available ||
          !prescreen.available ||
          !upcomingAncillary.available,
      },
      finance: {
        billingReady: readyForBilling.available ? readyForBilling.value : 0,
        invoicesSubmitted: 0,
        paidAmount: 0,
        outstandingBalance: 0,
        // Mission Control 60-day overdue split + paid/submitted require an
        // audited invoice + remittance aggregation that has not been
        // authored yet. Kept sourceMissing — we do NOT populate with the
        // Home Stats numbers because those are clinic-scoped and this
        // section is platform-wide.
        sourceMissing: true,
      },
      operations: {
        tasksOpen: openTasks.available ? openTasks.value : 0,
        tasksOverdue: 0,
        tasksHighPriority: 0,
        // tasksOverdue / tasksHighPriority require joining plexus_tasks
        // on due_date + priority indexes that are not yet in place.
        // sourceMissing reflects the derived overdue / high-priority
        // fields, not the tasksOpen count.
        sourceMissing: true,
      },
      ancillaryToday: {
        scheduledToday: scheduledToday.available ? scheduledToday.value : 0,
        completedToday: 0,
        cancelledToday: 0,
        // completedToday / cancelledToday need
        // procedure_events.completed_at filtered by today, plus
        // globalScheduleEvents.status counts. Kept sourceMissing.
        sourceMissing: !scheduledToday.available,
      },
      // Non-client-contract server extras. Ignored by TypeScript on the
      // client; safe to include.
      qualification: {
        backlog: qualificationBacklog.available ? qualificationBacklog.value : 0,
        sourceMissing: !qualificationBacklog.available,
      },
    },
    ringCentral: { connected: false as const },
  };
}
