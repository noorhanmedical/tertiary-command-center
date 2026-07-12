// Home stats service — powers /api/home-stats consumed by
// HomeLiveDashboard.
//
// V2 restore preview: returns the full shape the client expects but
// with honest zero values for every window/section that does not yet
// have a scoped repository helper. HomeLiveDashboard on the client
// renders honest zeros without inventing numbers.
//
// This is intentionally NOT the archive's broad getAll implementation
// (getAllScreeningBatches / getAllPatientScreenings / getAllBillingRecords
// / getAllUsers) — that pattern was rejected on scale grounds. When
// specific KPIs need to go live they will be added here as scoped
// aggregate repository helpers, matching the mission-control.repo
// pattern.

export type HomeWindowStat = {
  patients: number;
  ancillaries: number;
  activeSchedules: number;
  callsPlanned: number;
};

export type HomeMemberCallStat = { name: string; count: number };

export type HomeUpcomingStat = {
  ancillaryPatients: number;
  activeSchedules: number;
  callsDistributed: number;
  callsDone: number;
};

export type HomeFinanceStat = { last7: number; upcoming: number };

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
};

function emptyWindow(): HomeWindowStat {
  return { patients: 0, ancillaries: 0, activeSchedules: 0, callsPlanned: 0 };
}

export async function buildHomeStats(): Promise<HomeStatsResponse> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    today,
    finance: { last7: 0, upcoming: 0 },
    windows: {
      today: emptyWindow(),
      last7: emptyWindow(),
      last30: emptyWindow(),
    },
    upcoming: {
      ancillaryPatients: 0,
      activeSchedules: 0,
      callsDistributed: 0,
      callsDone: 0,
    },
    ancillaryBreakdown: {
      brainWave: 0,
      vitalWave: 0,
      ultrasound: 0,
      brainWaveUpcoming: 0,
      vitalWaveUpcoming: 0,
      ultrasoundUpcoming: 0,
    },
    callsByMember: { last7: [], last30: [] },
  };
}
