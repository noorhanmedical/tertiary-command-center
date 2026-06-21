import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

export type HomeStatsClinic = {
  clinicKey: string;
  clinicLabel: string;
  patientCount: number;
  brainWaveCount: number;
  vitalWaveCount: number;
  ultrasoundCount: number;
  ancillaryCount: number;
  brainWaveValue: number;
  vitalWaveValue: number;
  ultrasoundValue: number;
  estimatedValue: number;
};

export type HomeStatsResponse = {
  today: string;
  clinics: HomeStatsClinic[];
  totals: {
    totalPatients: number;
    totalAncillaries: number;
    activeSchedules: number;
    brainWaveCount: number;
    vitalWaveCount: number;
    ultrasoundCount: number;
    brainWaveValue: number;
    vitalWaveValue: number;
    ultrasoundValue: number;
    estimatedValue: number;
  };
  estimatesAvailable: boolean;
  valueAvailable: {
    brainWave: boolean;
    vitalWave: boolean;
    ultrasound: boolean;
  };
  callsPlannedToday: number;
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
