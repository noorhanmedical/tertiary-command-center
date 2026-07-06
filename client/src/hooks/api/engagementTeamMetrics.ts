import { useQuery } from "@tanstack/react-query";

export const TEAM_METRICS_QK = ["/api/engagement/team-metrics"];
export const ACTIVITY_FEED_QK = ["/api/engagement/activity-feed"];

export type DispositionCategory =
  | "scheduled"
  | "completed"
  | "noAnswer"
  | "voicemail"
  | "declined"
  | "followUp"
  | "other";

export type DispositionBreakdown = Record<DispositionCategory, number>;

export type CalendarStatus = "working" | "pto" | "unavailable";

export interface TeamMetricsMember {
  schedulerId: number;
  name: string;
  facility: string;
  userId: string | null;
  workingToday: boolean;
  calendarStatus: CalendarStatus;
  ptoToday: boolean;
  completedCallKpi: number;
  scheduledKpi: number;
  completedCalls: number;
  dispositions: DispositionBreakdown;
  scheduledToday: number;
  remainingCallKpi: number;
  remainingScheduledKpi: number;
  activeQueue: number;
  carryover: number;
  remainingCapacity: number;
}

export interface TeamMetricsTotals {
  members: number;
  workingMembers: number;
  completedCallKpi: number;
  scheduledKpi: number;
  completedCalls: number;
  scheduledToday: number;
  remainingCallKpi: number;
  remainingScheduledKpi: number;
  activeQueue: number;
  carryover: number;
  dispositions: DispositionBreakdown;
}

export interface TeamMetricsResponse {
  asOfDate: string;
  generatedAt: string;
  ringCentralLiveConnected: boolean;
  calendarAvailable: boolean;
  unattributedCalls: number;
  members: TeamMetricsMember[];
  totals: TeamMetricsTotals;
}

export interface ActivityFeedItem {
  id: string;
  kind: "journey" | "call";
  at: string | null;
  title: string;
  detail: string | null;
  patientName: string | null;
  actorName: string | null;
  eventType: string | null;
}

export interface ActivityFeedResponse {
  items: ActivityFeedItem[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  teamScoped: boolean;
  dayStart: string;
  ringCentralLiveConnected: boolean;
  generatedAt: string;
}

// Short polling interval so the dashboard stays "live" without a socket.
const POLL_MS = 15_000;

export function useTeamMetrics() {
  return useQuery<TeamMetricsResponse>({
    queryKey: TEAM_METRICS_QK,
    queryFn: async () => {
      const res = await fetch("/api/engagement/team-metrics", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load team metrics (${res.status})`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useActivityFeed(limit = 50) {
  return useQuery<ActivityFeedResponse>({
    queryKey: [...ACTIVITY_FEED_QK, limit],
    queryFn: async () => {
      const res = await fetch(`/api/engagement/activity-feed?limit=${limit}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load activity feed (${res.status})`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

// One-shot fetch of an older page using the `before` cursor. Used by the
// "Load more" affordance so polling (which always shows the freshest first
// page) and manual back-pagination don't fight each other.
export async function fetchActivityFeedPage(
  before: string,
  limit = 50,
): Promise<ActivityFeedResponse> {
  const res = await fetch(
    `/api/engagement/activity-feed?limit=${limit}&before=${encodeURIComponent(before)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to load activity feed (${res.status})`);
  return res.json();
}
