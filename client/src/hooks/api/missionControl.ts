import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

export type Wrapped<T> = { value: T; sourceMissing: boolean };

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
  prescreen: Wrapped<number>;
  readyToCall: Wrapped<number>;
  followUp: Wrapped<number>;
  callbacks: Wrapped<number>;
  pending: Wrapped<number>;
  noReport: Wrapped<number>;
  reEligible: Wrapped<number>;
  declined: Wrapped<number>;
  readyForBilling: Wrapped<number>;
  tasks: Wrapped<number>;
}

export interface MissionSections {
  calls: { madeToday: number; reachedToday: number; callbacksPending: number; madeLast7: number; sourceMissing: boolean };
  patientServices: { inPipeline: number; prescreenBacklog: number; pendingAncillary: number; declinedLast7: number; sourceMissing: boolean };
  finance: { billingReady: number; invoicesSubmitted: number; paidAmount: number; outstandingBalance: number; sourceMissing: boolean };
  operations: { tasksOpen: number; tasksOverdue: number; tasksHighPriority: number; sourceMissing: boolean };
  ancillaryToday: { scheduledToday: number; completedToday: number; cancelledToday: number; sourceMissing: boolean };
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
