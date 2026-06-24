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
  lookupTierKpi,
  sortTiers,
} from "../server/services/engagement/callSettingsService";
import {
  DEFAULT_GLOBAL_CALL_CONFIG,
  DEFAULT_WORKDAY_TIERS,
  type GlobalCallConfig,
  type WorkdayTier,
} from "../shared/schema/engagement";

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

const cfg = DEFAULT_GLOBAL_CALL_CONFIG;
const tiers = DEFAULT_WORKDAY_TIERS;

// ─── Default config + tiers worked examples (round mode) ────────────────────
// Completed comes from the workday-tier table; scheduled = round(completed×50%).
const base = { maxDailyCapacity: null as number | null };

assertEqual(
  "DEFAULT 100% workday → 30 calls / 15 scheduled",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 100 }, cfg, tiers);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [30, 15],
);

assertEqual(
  "DEFAULT 50% workday → 15 calls / 8 scheduled",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 50 }, cfg, tiers);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [15, 8],
);

assertEqual(
  "DEFAULT 25% workday → 7 calls / 4 scheduled (tier 25→7, round 3.5→4)",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 25 }, cfg, tiers);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [7, 4],
);

assertEqual(
  "DEFAULT 0% workday → 0 / 0",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 0 }, cfg, tiers);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [0, 0],
);

// ─── Tier lookup helper ─────────────────────────────────────────────────────
assertEqual("tier lookup 25% → 7", lookupTierKpi(tiers, 25), 7);
assertEqual("tier lookup 100% → 30", lookupTierKpi(tiers, 100), 30);
assertEqual("tier lookup unknown 75% → null", lookupTierKpi(tiers, 75), null);

// ─── Non-tier workday falls back to formula (round) ─────────────────────────
assertEqual(
  "75% workday with no tier → round(30×0.75)=23 calls",
  computeCallTargets({ ...base, callWorkdayPercent: 75 }, cfg, tiers)
    .completedCallKpi,
  23,
);

// ─── Adding a 75% tier makes it selectable and used ─────────────────────────
const tiersWith75: WorkdayTier[] = sortTiers([
  ...tiers,
  { workdayPercent: 75, completedKpi: 22 },
]);
assertEqual("added 75% tier is found", lookupTierKpi(tiersWith75, 75), 22);
assertEqual(
  "75% workday uses the new tier (22), not the formula (23)",
  computeCallTargets({ ...base, callWorkdayPercent: 75 }, cfg, tiersWith75)
    .completedCallKpi,
  22,
);

// ─── Changing scheduled target % recalculates scheduled KPIs ────────────────
const cfg40: GlobalCallConfig = { ...cfg, scheduledKpiPercent: 40 };
assertEqual(
  "scheduled % 40 → 100% workday gives 30 calls / 12 scheduled",
  (() => {
    const t = computeCallTargets({ ...base, callWorkdayPercent: 100 }, cfg40, tiers);
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [30, 12],
);

// ─── Switching rounding mode to floor changes the rounded values ────────────
const cfgFloor: GlobalCallConfig = { ...cfg, roundingMode: "floor" };
assertEqual(
  "floor mode: 25% workday (tier 7) → floor(3.5)=3 scheduled (was 4)",
  computeCallTargets({ ...base, callWorkdayPercent: 25 }, cfgFloor, tiers)
    .scheduledKpi,
  3,
);
const cfgCeil: GlobalCallConfig = { ...cfg, roundingMode: "ceil" };
assertEqual(
  "ceil mode: 75% workday no tier → ceil(22.5)=23 calls",
  computeCallTargets({ ...base, callWorkdayPercent: 75 }, cfgCeil, tiers)
    .completedCallKpi,
  23,
);

// ─── Explicit member overrides win over all formulas ────────────────────────
assertEqual(
  "explicit 7 completed / 3 scheduled wins over formula",
  (() => {
    const t = computeCallTargets(
      {
        ...base,
        callWorkdayPercent: 100,
        explicitCompletedKpi: 7,
        explicitScheduledKpi: 3,
      },
      cfg,
      tiers,
    );
    return [t.completedCallKpi, t.scheduledKpi];
  })(),
  [7, 3],
);

// ─── Per-member visit % overrides the global default ────────────────────────
assertEqual(
  "member visit % 50 at 100% workday → 15 visit / 15 outreach",
  (() => {
    const t = computeCallTargets(
      { ...base, callWorkdayPercent: 100, visitPercent: 50 },
      cfg,
      tiers,
    );
    return [t.visitTarget, t.outreachTarget];
  })(),
  [15, 15],
);
assertEqual(
  "null visit % falls back to global default (75) → 23 visit / 7 outreach",
  (() => {
    const t = computeCallTargets(
      { ...base, callWorkdayPercent: 100, visitPercent: null },
      cfg,
      tiers,
    );
    return [t.visitTarget, t.outreachTarget];
  })(),
  [23, 7],
);

// ─── Visit + outreach split always sums to completed-call KPI ───────────────
for (const pct of [100, 50, 25, 0, 33, 67, 80]) {
  for (const mode of ["round", "floor", "ceil"] as const) {
    const c: GlobalCallConfig = { ...cfg, roundingMode: mode };
    const t = computeCallTargets({ ...base, callWorkdayPercent: pct }, c, tiers);
    assertEqual(
      `visit + outreach == completed KPI @ workday ${pct}% (${mode})`,
      t.visitTarget + t.outreachTarget,
      t.completedCallKpi,
    );
  }
}

// ─── maxDailyCapacity falls back to completed KPI when unset ─────────────────
assertEqual(
  "maxDailyCapacity defaults to completed KPI when null",
  computeCallTargets({ ...base, callWorkdayPercent: 100 }, cfg, tiers)
    .maxDailyCapacity,
  30,
);
assertEqual(
  "maxDailyCapacity honored when explicitly set",
  computeCallTargets(
    { ...base, callWorkdayPercent: 100, maxDailyCapacity: 12 },
    cfg,
    tiers,
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
