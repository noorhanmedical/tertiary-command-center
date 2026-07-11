import { useEffect, useRef, useState } from "react";
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

export interface MemberLiveProgress {
  schedulerId: number;
  name: string;
  facility: string | null;
  active: boolean;
  workingToday: boolean;
  completedToday: number;
  remaining: number;
  inProgress: number;
  completedKpi: number;
}

export interface ActivityFeedEvent {
  id: number;
  eventType: string;
  patientName: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
}

export interface LiveProgressResponse {
  members: MemberLiveProgress[];
  activity: ActivityFeedEvent[];
  totals: {
    completedToday: number;
    remaining: number;
    inProgress: number;
    activeMembers: number;
  };
  asOf: string;
}

export const ENGAGEMENT_DISTRIBUTION_LIVE_QK = [
  "/api/engagement/distribution/live",
];

// Push-first live progress.
//
// A Server-Sent Events stream nudges the client to refetch within ~1s of a
// real assignment/outcome event. While the stream is healthy we keep only a
// slow safety poll; if the stream drops we fall back to tight `refetchMs`
// polling so the feed never goes stale.
export function useDistributionLive(enabled = true, refetchMs = 15_000) {
  const queryClient = useQueryClient();
  const [streamConnected, setStreamConnected] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof EventSource === "undefined"
    ) {
      setStreamConnected(false);
      return;
    }

    let cancelled = false;
    const es = new EventSource("/api/engagement/distribution/stream", {
      withCredentials: true,
    });

    es.onopen = () => {
      if (!cancelled) setStreamConnected(true);
    };

    es.addEventListener("activity", () => {
      // Debounce bursts (e.g. an apply that writes many events at once) into a
      // single refetch.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ENGAGEMENT_DISTRIBUTION_LIVE_QK,
        });
      }, 250);
    });

    es.onerror = () => {
      // EventSource auto-reconnects; flip to disconnected so polling resumes
      // in the meantime.
      if (!cancelled) setStreamConnected(false);
    };

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      es.close();
      setStreamConnected(false);
    };
  }, [enabled, queryClient]);

  return useQuery<LiveProgressResponse>({
    queryKey: ENGAGEMENT_DISTRIBUTION_LIVE_QK,
    queryFn: async () => {
      const res = await fetch("/api/engagement/distribution/live", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Failed to load live progress (${res.status})`,
        );
      }
      return res.json();
    },
    enabled,
    refetchInterval: enabled ? (streamConnected ? 60_000 : refetchMs) : false,
    refetchIntervalInBackground: false,
  });
}

export type MemberCaseCategory =
  | "remaining"
  | "in_progress"
  | "completed_today";

export interface MemberCaseItem {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  facility: string | null;
  engagementStatus: string | null;
  engagementBucket: string | null;
  category: MemberCaseCategory;
  lastAttemptAt: string | null;
  lastCallOutcome: string | null;
  callAttemptCount: number;
  nextActionAt: string | null;
  updatedAt: string | null;
}

export interface MemberCasesResponse {
  schedulerId: number;
  name: string | null;
  counts: { remaining: number; inProgress: number; completedToday: number };
  cases: MemberCaseItem[];
  asOf: string;
}

export function useDistributionMemberCases(
  schedulerId: number | null,
  enabled = true,
  refetchMs?: number,
) {
  const active = enabled && schedulerId != null;
  return useQuery<MemberCasesResponse>({
    queryKey: ["/api/engagement/distribution/member", schedulerId, "cases"],
    queryFn: async () => {
      const res = await fetch(
        `/api/engagement/distribution/member/${schedulerId}/cases`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Failed to load member cases (${res.status})`,
        );
      }
      return res.json();
    },
    enabled: active,
    staleTime: 10_000,
    refetchInterval: active && refetchMs ? refetchMs : false,
    refetchIntervalInBackground: false,
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
        queryKey: ENGAGEMENT_DISTRIBUTION_LIVE_QK,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/engagement/assignment-board"],
      });
    },
  });
}
