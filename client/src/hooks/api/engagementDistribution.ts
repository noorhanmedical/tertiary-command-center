import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export const ENGAGEMENT_DISTRIBUTION_QK = ["/api/engagement/distribution/preview"];

export type DistributionLane = "visit" | "outreach";

export interface ProposedAssignment {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  facility: string | null;
  scheduleDate: string | null;
  lane: DistributionLane;
  schedulerId: number;
  schedulerName: string;
}

export interface UnplacedCase {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  facility: string | null;
  lane: DistributionLane;
  reason: string;
}

export interface MemberAllocationSummary {
  schedulerId: number;
  name: string;
  facility: string | null;
  remainingCapacity: number;
  visitTarget: number;
  outreachTarget: number;
  assignedTotal: number;
  assignedVisit: number;
  assignedOutreach: number;
  workingToday: boolean;
  active: boolean;
}

export interface DistributionPlan {
  assignments: ProposedAssignment[];
  unplaced: UnplacedCase[];
  memberSummaries: MemberAllocationSummary[];
  totals: {
    poolSize: number;
    assigned: number;
    unplaced: number;
    eligibleMembers: number;
  };
}

export interface DistributionPreviewResponse {
  plan: DistributionPlan;
  roster: MemberAllocationSummary[];
  poolSize: number;
}

export interface AppliedAssignment {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  schedulerId: number;
  schedulerName: string;
  lane: DistributionLane;
  nextActionAt: string | null;
}

export interface SkippedAssignment {
  executionCaseId: number;
  patientName: string;
  schedulerId: number;
  reason: string;
}

export interface ApplyDistributionResult {
  ok: boolean;
  applied: AppliedAssignment[];
  skipped: SkippedAssignment[];
  summary: { proposed: number; applied: number; skipped: number };
}

export function useDistributionPreview(enabled = true) {
  return useQuery<DistributionPreviewResponse>({
    queryKey: ENGAGEMENT_DISTRIBUTION_QK,
    queryFn: async () => {
      const res = await fetch("/api/engagement/distribution/preview", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load preview (${res.status})`);
      }
      return res.json();
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useApplyDistribution() {
  const queryClient = useQueryClient();
  return useMutation<ApplyDistributionResult, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/engagement/distribution/apply", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ENGAGEMENT_DISTRIBUTION_QK });
      queryClient.invalidateQueries({
        queryKey: ["/api/engagement/assignment-board"],
      });
    },
  });
}
