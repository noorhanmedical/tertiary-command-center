// Phase 3 semantic tests — verify SERVICE-layer decisions with fake
// repositories injected via the exported `repo` option. No DB required.
//
// These tests prove:
//
//   §A A valid zero count keeps sourceMissing = false.
//   §B An unavailable source produces sourceMissing = true.
//   §C The ancillary-patients metric flows from the distinct-patient
//      scheduled helper (NOT the active-case count).
//   §D Callback count uses an injected clock — no `new Date()` inside
//      the repository layer.
//   §E Home Stats without a clinic scope returns sourceMissing:true for
//      the tenant-scoped finance + outreach metrics.
//   §F Home Stats with a clinic scope returns sourceMissing:false for
//      those metrics even when the value is 0.
//
// Runnable via:
//   DATABASE_URL=postgres://x npx tsx tests/unit/phase3SemanticFixtures.test.ts
//
// (DATABASE_URL is required only so server/db.ts imports; nothing
// actually connects because every repo call is a fake.)

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

// Types are erased — a static `import type` never triggers module
// evaluation and is safe to hoist above the env-var assignment.
import type { MissionRepoDeps } from "../../server/services/missionControl/missionControlService";
import type { HomeStatsRepoDeps } from "../../server/services/homeStats/homeStatsService";

// The value imports must come AFTER the env-var is set, otherwise
// server/db.ts (transitively imported) throws before we can stub it.
const { buildMissionControlSpine } = await import(
  "../../server/services/missionControl/missionControlService"
);
const { buildHomeStats } = await import(
  "../../server/services/homeStats/homeStatsService"
);

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`- ${msg}`);
};

type MV<T> =
  | { available: true; value: T }
  | { available: false; reason: string };

// ── §A + §B + §D: Mission Control spine ────────────────────────
const fixedNow = new Date("2026-06-15T00:00:00.000Z");
let callbackNowSeen: Date | null = null;

const missionFake: MissionRepoDeps = {
  countActiveExecutionCases: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countOpenPlexusTasks_platformWide: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countPrescreenPending: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countReadyForBilling: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countReportsMissing: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countRunningAnalysisJobs_platformWide: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countScheduledInWindow: async (_scope, win) => {
    // Deterministic window boundaries — start MUST equal UTC midnight
    // of fixedNow, and end MUST be the next day.
    if (win.start.toISOString() !== "2026-06-15T00:00:00.000Z") {
      fail(`window.start not UTC midnight of fixedNow (got ${win.start.toISOString()})`);
    }
    if (win.end.toISOString() !== "2026-06-16T00:00:00.000Z") {
      fail(`window.end not next UTC day (got ${win.end.toISOString()})`);
    }
    return { available: true, value: 0 } as MV<number>;
  },
  countCallbacksPending_platformWide: async (_scope, now) => {
    callbackNowSeen = now;
    return { available: true, value: 0 } as MV<number>;
  },
  countUpcomingAncillaryPatients_UNAVAILABLE: async () =>
    ({ available: false, reason: "no source" }) as MV<number>,
};

const spineOut = await buildMissionControlSpine({ now: fixedNow, repo: missionFake });

// §A: valid zero counts keep sourceMissing:false.
for (const k of ["prescreen", "callbacks", "noReport", "readyForBilling", "tasks"] as const) {
  const w = (spineOut.spine as any)[k];
  if (w.sourceMissing !== false) {
    fail(`§A spine.${k}.sourceMissing must be false when repo returned available:true (got ${JSON.stringify(w)})`);
  }
  if (w.value !== 0) {
    fail(`§A spine.${k}.value must be 0 (got ${w.value})`);
  }
}
// §B: unavailable source must be sourceMissing:true.
if (spineOut.spine.pending.sourceMissing !== true) {
  fail(
    `§B spine.pending must be sourceMissing:true when repo returned available:false (got ${JSON.stringify(spineOut.spine.pending)})`,
  );
}
if (spineOut.spine.pending.value !== 0) {
  fail(`§B spine.pending.value should be 0 fallback (got ${spineOut.spine.pending.value})`);
}
// §D: injected clock reached the repo.
if (!callbackNowSeen || callbackNowSeen.toISOString() !== fixedNow.toISOString()) {
  fail(`§D callback repo did not receive fixedNow (got ${callbackNowSeen?.toISOString?.() ?? String(callbackNowSeen)})`);
}

// ── §C + §E + §F: Home Stats ────────────────────────────────────
const homeFake: HomeStatsRepoDeps = {
  countPatientsAddedInRange: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countActiveSchedulesInRange: async () =>
    ({ available: true, value: 0 }) as MV<number>,
  countOutreachCallsInRange: async (_w, scope) =>
    scope.clinicId == null
      ? ({ available: false, reason: "no clinic scope" } as MV<number>)
      : ({ available: true, value: 0 } as MV<number>),
  sumPaymentsPostedInRange: async (_w, scope) =>
    scope.clinicId == null
      ? ({ available: false, reason: "no clinic scope" } as MV<number>)
      : ({ available: true, value: 0 } as MV<number>),
  sumInvoicesOutstanding: async (scope) =>
    scope.clinicId == null
      ? ({ available: false, reason: "no clinic scope" } as MV<number>)
      : ({ available: true, value: 0 } as MV<number>),
  countAncillaryByCategoryInRange: async () =>
    ({
      available: true,
      value: { brainWave: 0, vitalWave: 0, ultrasound: 0 },
    }) as MV<{ brainWave: number; vitalWave: number; ultrasound: number }>,
  countDistinctPatientsScheduledInRange: async () =>
    ({ available: true, value: 42 }) as MV<number>,
};

const adminRes = await buildHomeStats(
  { clinicId: null },
  { now: fixedNow, repo: homeFake },
);

// §E: without clinic scope, finance + call metrics must be sourceMissing.
if (adminRes.availability?.finance?.last7?.sourceMissing !== true) {
  fail("§E finance.last7 must be sourceMissing:true when clinicId is null");
}
if (adminRes.availability?.finance?.upcoming?.sourceMissing !== true) {
  fail("§E finance.upcoming must be sourceMissing:true when clinicId is null");
}
for (const k of ["today", "last7", "last30"] as const) {
  const p = adminRes.availability?.windows?.[k]?.callsPlanned;
  if (p?.sourceMissing !== true) {
    fail(`§E windows.${k}.callsPlanned must be sourceMissing:true when clinicId is null`);
  }
}
if (adminRes.finance.last7 !== 0 || adminRes.finance.upcoming !== 0) {
  fail(`§E finance numeric fallback must be 0 (got ${adminRes.finance.last7}/${adminRes.finance.upcoming})`);
}

// §C: ancillaryPatients must come from the distinct-patient helper (42).
if (adminRes.upcoming.ancillaryPatients !== 42) {
  fail(
    `§C upcoming.ancillaryPatients must come from countDistinctPatientsScheduledInRange (expected 42, got ${adminRes.upcoming.ancillaryPatients})`,
  );
}

// §F: with clinic scope, finance + call metrics must be sourceMissing:false (even at value=0).
const clinicRes = await buildHomeStats(
  { clinicId: 7 },
  { now: fixedNow, repo: homeFake },
);
if (clinicRes.availability?.finance?.last7?.sourceMissing !== false) {
  fail("§F finance.last7 must be sourceMissing:false when clinicId=7");
}
if (clinicRes.availability?.finance?.upcoming?.sourceMissing !== false) {
  fail("§F finance.upcoming must be sourceMissing:false when clinicId=7");
}
for (const k of ["today", "last7", "last30"] as const) {
  const p = clinicRes.availability?.windows?.[k]?.callsPlanned;
  if (p?.sourceMissing !== false) {
    fail(`§F windows.${k}.callsPlanned must be sourceMissing:false when clinicId=7 (got ${JSON.stringify(p)})`);
  }
}

if (failures > 0) {
  console.error(`phase3SemanticFixtures.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("phase3SemanticFixtures.test.ts: all tests passed");
