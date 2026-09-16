import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

// Legacy per-field wrapper. Retained for backward compatibility; new code
// uses the canonical MissionMetric below.
export type Wrapped<T> = { value: T; sourceMissing: boolean };

// ─── Canonical Mission Control metric contract (MC-DATA-001) ───────────────
// ONE representation for every Mission Control metric. Availability is
// per-field: a real measured 0 is { value: 0, sourceMissing: false }; an
// unavailable source is { value: null, sourceMissing: true }. A `0` is NEVER
// used to represent "no source", and no metric's availability depends on a
// sibling's.
export type MetricUnit = "count" | "currency" | "percent" | "duration";

export type MetricDelta = {
  value: number;
  pct: number | null;
  direction: "up" | "down" | "flat";
  comparisonMissing?: boolean;
};

export type MissionMetric = {
  key: string;
  value: number | null;
  unit: MetricUnit;
  sourceMissing: boolean;
  reason?: string;
  // delta / freshnessAt are part of the contract but NOT computed in
  // MC-DATA-001 (comparison work lands in a later phase).
  delta?: MetricDelta;
  freshnessAt?: string;
};

export type MissionLaneStatus = "Watch" | "Blocked" | "Ready" | "In Progress" | "Complete";
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

export interface MissionRoleQueue {
  role: string;
  label: string;
  total: number;
  urgent: number;
  blocked: number;
  ready: number;
  sourceMissing: boolean;
}

export interface MissionSpine {
  prescreen: MissionMetric;
  readyToCall: MissionMetric;
  followUp: MissionMetric;
  callbacks: MissionMetric;
  pending: MissionMetric;
  noReport: MissionMetric;
  reEligible: MissionMetric;
  declined: MissionMetric;
  readyForBilling: MissionMetric;
  tasks: MissionMetric;
}

// Per-field metric contract: NO section-level `sourceMissing`. Each metric
// carries its own availability so a live sibling is never blanked by an
// unavailable one. Presentation derives a family state from the children.
export interface MissionSections {
  calls: { madeToday: MissionMetric; reachedToday: MissionMetric; callbacksPending: MissionMetric; madeLast7: MissionMetric };
  patientServices: { inPipeline: MissionMetric; prescreenBacklog: MissionMetric; pendingAncillary: MissionMetric; declinedLast7: MissionMetric };
  finance: { billingReady: MissionMetric; invoicesSubmitted: MissionMetric; paidAmount: MissionMetric; outstandingBalance: MissionMetric };
  operations: { tasksOpen: MissionMetric; tasksOverdue: MissionMetric; tasksHighPriority: MissionMetric };
  ancillaryToday: { scheduledToday: MissionMetric; completedToday: MissionMetric; cancelledToday: MissionMetric };
}

export interface MissionControlSpine {
  generatedAt: string;
  spine: MissionSpine;
  lanes: MissionLaneRow[];
  clinics: string[];
  owners: string[];
  roleQueues: MissionRoleQueue[];
  sections: MissionSections;
  ringCentral: { connected: boolean };
}

export function useMissionControlSpine() {
  return useQuery<MissionControlSpine>({
    queryKey: qk.missionControl.spine(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
