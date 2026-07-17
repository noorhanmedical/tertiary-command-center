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

import { countActiveExecutionCases } from "../../repositories/missionControl.repo";
import { countOpenPlexusTasks } from "../../repositories/missionControl.repo";

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
  // Two bounded, indexed counts. All other sections stay in honest
  // "Not available" mode until they get scoped aggregate repository
  // helpers of their own.
  const [activeCases, openTasks] = await Promise.all([
    countActiveExecutionCases(),
    countOpenPlexusTasks(),
  ]);

  const noCases = activeCases === 0;
  const noTasks = openTasks === 0;

  const spine = {
    prescreen: wrap(0, true),
    readyToCall: wrap(0, true),
    followUp: wrap(0, true),
    callbacks: wrap(0, true),
    pending: wrap(0, true),
    noReport: wrap(0, true),
    reEligible: wrap(0, true),
    declined: wrap(0, true),
    readyForBilling: wrap(0, true),
    // Only sections with real scoped counts are non-missing.
    tasks: wrap(openTasks, noTasks),
  };

  const roleQueues = ROLE_DEFS.map(({ role, label }) => ({
    role,
    label,
    total: 0,
    urgent: 0,
    blocked: 0,
    ready: 0,
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
        callbacksPending: 0,
        madeLast7: 0,
        sourceMissing: true,
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
        sourceMissing: true,
      },
      operations: {
        tasksOpen: openTasks,
        tasksOverdue: 0,
        tasksHighPriority: 0,
        sourceMissing: noTasks,
      },
      ancillaryToday: {
        scheduledToday: 0,
        completedToday: 0,
        cancelledToday: 0,
        sourceMissing: true,
      },
    },
    ringCentral: { connected: false as const },
  };
}
