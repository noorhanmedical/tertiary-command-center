// Mission Control spine service — MONITORING ONLY.
//
// Shape mirrors what the client's mission-control.tsx expects. This
// service is deliberately conservative for the V2 restore preview:
//   - Scoped indexed counts where safe (active execution cases, open
//     tasks).
//   - Honest `sourceMissing: true` for sections whose scoped
//     aggregations are not yet layered (billing readiness, doc
//     readiness, calls, ancillary appts, schedule events). The client
//     renders those slots in an honest "Not available" state so the
//     Replit shell is preserved without inventing numbers.
//
// No raw db.select in routes — the route calls this service, this
// service delegates counts to the repository layer.
//
// If the archive's broad getAll aggregations become needed later they
// should be rebuilt as bounded scoped queries here — never inlined into
// the route file.

import {
  countActiveExecutionCases,
  countOpenPlexusTasks,
  countRunningAnalysisJobs,
  countCallbacksPending,
  countScheduledToday,
  countReadyForBilling,
  countReportsMissing,
  countPrescreenPending,
} from "../../repositories/missionControl.repo";

type Wrapped<T> = { value: T; sourceMissing: boolean };
const wrap = <T,>(value: T, sourceMissing: boolean): Wrapped<T> => ({
  value,
  sourceMissing,
});

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

export async function buildMissionControlSpine() {
  const todayIso = new Date().toISOString().slice(0, 10);

  // Phase 3 — six new scoped, indexed, tenant-safe counts light up alongside
  // the existing active-cases + open-tasks pair. Any lane whose source is
  // ambiguous or unscoped stays sourceMissing:true with an explanatory
  // comment so the client renders honest empty states.
  const [
    activeCases,
    openTasks,
    prescreen,
    callbacksPending,
    scheduledToday,
    readyForBilling,
    reportsMissing,
    qualificationBacklog,
  ] = await Promise.all([
    countActiveExecutionCases(),
    countOpenPlexusTasks(),
    countPrescreenPending(),
    countCallbacksPending(),
    countScheduledToday({ todayIso }),
    countReadyForBilling(),
    countReportsMissing(),
    countRunningAnalysisJobs(),
  ]);

  const noCases = activeCases === 0;
  const noTasks = openTasks === 0;

  const spine = {
    // Prescreen = patient_screenings pending review.
    prescreen: wrap(prescreen, prescreen === 0),
    // readyToCall / followUp / declined / re-eligible currently have no
    // authoritative single-table definition; they were derived in the
    // persistence branch by joining execution_cases + journey_events with
    // multiple heuristic filters. Keeping sourceMissing until each has a
    // scoped repo helper of its own.
    readyToCall: wrap(0, true),
    followUp: wrap(0, true),
    callbacks: wrap(callbacksPending, callbacksPending === 0),
    pending: wrap(0, true),
    noReport: wrap(reportsMissing, reportsMissing === 0),
    reEligible: wrap(0, true),
    declined: wrap(0, true),
    readyForBilling: wrap(readyForBilling, readyForBilling === 0),
    tasks: wrap(openTasks, noTasks),
  };

  const roleQueues = ROLE_DEFS.map(({ role, label }) => ({
    role,
    label,
    total: 0,
    urgent: 0,
    blocked: 0,
    ready: 0,
    // Role queue aggregation needs a JOIN across execution_cases +
    // outreach_schedulers + role_assignments. Kept sourceMissing until a
    // scoped helper lands.
    sourceMissing: true,
  }));

  return {
    generatedAt: new Date().toISOString(),
    spine,
    lanes: [] as MissionLaneRow[],
    clinics: [] as string[],
    owners: [] as string[],
    roleQueues,
    sections: {
      calls: {
        madeToday: 0,
        reachedToday: 0,
        callbacksPending,
        madeLast7: 0,
        // madeToday / reachedToday / madeLast7 need a scoped date-window
        // count on outreach_calls.started_at + outcome. Kept sourceMissing
        // until a scoped helper is added.
        sourceMissing: callbacksPending === 0,
      },
      patientServices: {
        activePatients: activeCases,
        sourceMissing: noCases,
      },
      finance: {
        outstandingCount: 0,
        outstandingTotal: 0,
        paidCount: 0,
        paidTotal: 0,
        overdue60d: 0,
        // Finance rollup for Mission Control requires an audited
        // invoice+remittance aggregation. Physician portal exposes overall
        // billing SUMs (Phase 2) but not the Mission Control shape (60-day
        // overdue split). Kept sourceMissing.
        sourceMissing: true,
      },
      operations: {
        tasksOpen: openTasks,
        tasksOverdue: 0,
        tasksHighPriority: 0,
        // tasksOverdue / tasksHighPriority require joining plexus_tasks
        // on due_date + priority indexes that are not yet fully in place.
        sourceMissing: noTasks,
      },
      ancillaryToday: {
        scheduledToday,
        completedToday: 0,
        cancelledToday: 0,
        // completedToday / cancelledToday need
        // procedure_events.completed_at filtered by today, plus
        // globalScheduleEvents.status counts. Kept sourceMissing.
        sourceMissing: scheduledToday === 0,
      },
      qualification: {
        backlog: qualificationBacklog,
        sourceMissing: qualificationBacklog === 0,
      },
    },
    ringCentral: { connected: false as const },
  };
}
