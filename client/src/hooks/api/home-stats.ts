import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

export type HomeWindowStat = {
  patients: number;
  ancillaries: number;
  activeSchedules: number;
  callsPlanned: number;
};

export type HomeMemberCallStat = {
  name: string;
  count: number;
};

export type HomeUpcomingStat = {
  ancillaryPatients: number;
  activeSchedules: number;
  callsDistributed: number;
  callsDone: number;
};

export type HomeStatsResponse = {
  today: string;
  windows: {
    today: HomeWindowStat;
    last7: HomeWindowStat;
    last30: HomeWindowStat;
  };
  upcoming: HomeUpcomingStat;
  ancillaryBreakdown: {
    brainWave: number;
    vitalWave: number;
    ultrasound: number;
  };
  callsByMember: {
    last7: HomeMemberCallStat[];
    last30: HomeMemberCallStat[];
  };
};

export function useHomeStats(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useQuery<HomeStatsResponse>({
    queryKey: qk.homeStats.today(),
    queryFn: async () => {
      const res = await fetch("/api/home-stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load home stats");
      return res.json();
    },
    enabled,
    refetchInterval: 60_000,
  });
}
