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

export type HomeFinanceStat = {
  last7: number;
  upcoming: number;
};

// Per-metric availability sidecar. Introduced in Phase 3 correction to
// let consumers render honest "Unavailable" states without inventing
// values. All fields are optional; a pre-Phase-3 client that ignores
// this shape continues to render fine.
export type HomeStatsAvailability = {
  finance?: {
    last7?: { sourceMissing: boolean; reason?: string };
    upcoming?: { sourceMissing: boolean; reason?: string };
  };
  windows?: {
    today?: { callsPlanned?: { sourceMissing: boolean; reason?: string } };
    last7?: { callsPlanned?: { sourceMissing: boolean; reason?: string } };
    last30?: { callsPlanned?: { sourceMissing: boolean; reason?: string } };
  };
  upcoming?: {
    ancillaryPatients?: { sourceMissing: boolean; reason?: string };
    callsDistributed?: { sourceMissing: boolean; reason?: string };
    callsDone?: { sourceMissing: boolean; reason?: string };
  };
  callsByMember?: { sourceMissing: boolean; reason?: string };
};

export type HomeStatsResponse = {
  today: string;
  finance: HomeFinanceStat;
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
    brainWaveUpcoming: number;
    vitalWaveUpcoming: number;
    ultrasoundUpcoming: number;
  };
  callsByMember: {
    last7: HomeMemberCallStat[];
    last30: HomeMemberCallStat[];
  };
  availability?: HomeStatsAvailability;
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
