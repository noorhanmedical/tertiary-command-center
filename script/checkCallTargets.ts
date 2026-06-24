/**
 * Verification harness for Engagement Call Settings target math.
 *
 * This repo has no unit-test runner wired into package.json, so — following
 * the existing `script/*.ts` + tsx convention — this is a runnable assertion
 * script that locks the product-spec worked examples for computeCallTargets.
 *
 *   Run:  npx tsx script/checkCallTargets.ts
 *
 * Exits non-zero on any failed assertion so it can gate CI later.
 */
import {
  computeCallTargets,
  remainingCapacity,
  resolveWorkingToday,
  deriveWorkingStatus,
} from "../server/services/engagement/callSettingsService";
import { DEFAULT_CALL_CONFIG, type EngagementCallConfig } from "../shared/schema";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(
      `✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`✓ ${label}`);
  }
}

const cfg = DEFAULT_CALL_CONFIG;

// ─── Completed-call KPI by workday %, default config (tier-driven) ──────────
const base = {
  visitPercent: null,
  maxDailyCapacity: null,
};

assertEqual(
  "100% workday → 30 calls / 15 scheduled",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 100 }, cfg);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [30, 15],
);

assertEqual(
  "50% workday → 15 calls / 8 scheduled",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 50 }, cfg);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [15, 8],
);

assertEqual(
  "25% workday → 7 calls / 4 scheduled (tier 7, round 3.5→4)",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 25 }, cfg);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [7, 4],
);

assertEqual(
  "0% workday → 0 / 0",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 0 }, cfg);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [0, 0],
);

// ─── Non-tier workday % falls back to floor(full-day × workday%) ────────────
assertEqual(
  "33% workday (no tier) → floor(30 × 33%) = 9 calls",
  computeCallTargets({ ...base, callWorkdayPercent: 33 }, cfg).completedCallKpi,
  9,
);

// ─── Workday tier overrides the formula ─────────────────────────────────────
assertEqual(
  "tier match wins: 25% workday → tier KPI 7 (not floor(30×25%)=7 — same here, so test a custom tier)",
  (() => {
    const custom: EngagementCallConfig = {
      ...cfg,
      workdayTiers: [{ workdayPercent: 25, completedCallKpi: 12 }],
    };
    return computeCallTargets({ ...base, callWorkdayPercent: 25 }, custom)
      .completedCallKpi;
  })(),
  12,
);

assertEqual(
  "no tier match → floor formula (custom tiers only cover 100%)",
  (() => {
    const custom: EngagementCallConfig = {
      ...cfg,
      workdayTiers: [{ workdayPercent: 100, completedCallKpi: 40 }],
    };
    return computeCallTargets({ ...base, callWorkdayPercent: 50 }, custom)
      .completedCallKpi;
  })(),
  15,
);

// ─── Rounding mode applies to scheduled KPI + visit split ───────────────────
assertEqual(
  "floor rounding: 25% workday → 7 calls / 3 scheduled (floor 3.5→3)",
  (() => {
    const floorCfg: EngagementCallConfig = { ...cfg, roundingMode: "floor" };
    const t = computeCallTargets({ ...base, callWorkdayPercent: 25 }, floorCfg);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [7, 3],
);

assertEqual(
  "ceil rounding: 25% workday → 7 calls / 4 scheduled (ceil 3.5→4)",
  (() => {
    const ceilCfg: EngagementCallConfig = { ...cfg, roundingMode: "ceil" };
    const t = computeCallTargets({ ...base, callWorkdayPercent: 25 }, ceilCfg);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [7, 4],
);

// ─── Explicit per-member overrides win ──────────────────────────────────────
assertEqual(
  "explicit completed KPI overrides tier/formula",
  computeCallTargets(
    { ...base, callWorkdayPercent: 100, explicitCompletedCallKpi: 9 },
    cfg,
  ).completedCallKpi,
  9,
);

assertEqual(
  "explicit scheduled KPI overrides percentage calc",
  computeCallTargets(
    { ...base, callWorkdayPercent: 100, explicitScheduledKpi: 25 },
    cfg,
  ).scheduledKpi,
  25,
);

// ─── Per-member visit % overrides the global default ────────────────────────
assertEqual(
  "per-member visit % overrides default (100% → all visit, 0 outreach)",
  (() => {
    const t = computeCallTargets(
      { ...base, callWorkdayPercent: 100, visitPercent: 100 },
      cfg,
    );
    return [t.visitTarget, t.outreachTarget, t.effectiveVisitPercent];
  })(),
  [30, 0, 100],
);

assertEqual(
  "null visit % falls back to global default 75% (round 22.5→23 visit)",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 100 }, cfg);
    return [t.visitTarget, t.outreachTarget, t.effectiveVisitPercent];
  })(),
  [23, 7, 75],
);

// ─── Visit + outreach split always sums to completed-call KPI ───────────────
for (const pct of [100, 50, 25, 0, 33, 67, 80]) {
  const t = computeCallTargets({ ...base, callWorkdayPercent: pct }, cfg);
  assertEqual(
    `visit + outreach == completed KPI @ workday ${pct}%`,
    t.visitTarget + t.outreachTarget,
    t.completedCallKpi,
  );
}

// ─── maxDailyCapacity falls back to completed KPI when unset ─────────────────
assertEqual(
  "maxDailyCapacity defaults to completed KPI when null",
  computeCallTargets({ ...base, callWorkdayPercent: 100 }, cfg).maxDailyCapacity,
  30,
);
assertEqual(
  "maxDailyCapacity honored when explicitly set",
  computeCallTargets(
    { ...base, callWorkdayPercent: 100, maxDailyCapacity: 12 },
    cfg,
  ).maxDailyCapacity,
  12,
);

// ─── remainingCapacity = max(0, KPI − carryover) ────────────────────────────
assertEqual("remaining: 30 KPI − 8 carryover = 22", remainingCapacity(30, 8), 22);
assertEqual("remaining never negative", remainingCapacity(7, 20), 0);

// ─── working-today derivation (manual override + PTO + roster presence) ─────
assertEqual(
  "manual override force-working beats PTO",
  resolveWorkingToday(true, false),
  true,
);
assertEqual(
  "manual override force-off beats calendar working",
  resolveWorkingToday(false, true),
  false,
);
assertEqual(
  "auto (null override) defers to calendar working",
  resolveWorkingToday(null, true),
  true,
);
assertEqual(
  "auto with unknown calendar defaults to working (never silently blocks)",
  resolveWorkingToday(null, null),
  true,
);

const ptoSet = new Set<string>(["u1"]);
assertEqual(
  "PTO user derives status=pto, not working",
  (() => {
    const s = deriveWorkingStatus("u1", ptoSet);
    return [s.calendarStatus, s.calendarWorkingToday, s.ptoToday];
  })(),
  ["pto", false, true],
);
assertEqual(
  "roster user not on PTO derives working",
  (() => {
    const s = deriveWorkingStatus("u2", ptoSet);
    return [s.calendarStatus, s.calendarWorkingToday, s.ptoToday];
  })(),
  ["working", true, false],
);
assertEqual(
  "no linked user → calendar unavailable / unknown",
  (() => {
    const s = deriveWorkingStatus(null, ptoSet);
    return [s.calendarStatus, s.calendarWorkingToday, s.ptoToday];
  })(),
  ["unavailable", null, false],
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Engagement Call Settings target assertions passed.");
