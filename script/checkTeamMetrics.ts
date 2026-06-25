/**
 * Verification harness for Engagement Live Team Metrics (Task #532, Phase 3).
 *
 * This repo has no unit-test runner wired into package.json, so — following the
 * existing `script/*.ts` + tsx convention — this is a runnable assertion script
 * that locks the invariants of the team-metrics aggregation:
 *
 *   • Every known call outcome maps to a NON-"other" disposition.
 *   • Disposition breakdown counts always sum to the total attempts.
 *   • remainingKpi == max(0, target − completed), never negative.
 *   • Team totals == the sum of the per-member rows (single source of truth).
 *
 *   Run:  npx tsx script/checkTeamMetrics.ts
 *
 * Exits non-zero on any failed assertion so it can gate CI later.
 */
import {
  DISPOSITION_CATEGORIES,
  mapOutcomeToDisposition,
  emptyDispositionBreakdown,
  summarizeDispositions,
  computeRemainingKpi,
  aggregateTeamTotals,
  type TeamMetricsMember,
  type DispositionBreakdown,
} from "../server/services/engagement/teamMetricsService";
import { OUTREACH_CALL_OUTCOMES } from "../shared/schema/outreach";
import { CALL_RESULT_OUTCOMES } from "../server/services/callResult/recordCallResult";

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

function assert(label: string, cond: boolean) {
  assertEqual(label, cond, true);
}

// ─── Every known outcome maps to a non-"other" disposition ──────────────────
for (const outcome of OUTREACH_CALL_OUTCOMES) {
  assert(
    `outreach outcome "${outcome}" maps to a known disposition (not other)`,
    mapOutcomeToDisposition(outcome) !== "other",
  );
}
for (const outcome of CALL_RESULT_OUTCOMES) {
  assert(
    `call-result outcome "${outcome}" maps to a known disposition (not other)`,
    mapOutcomeToDisposition(outcome) !== "other",
  );
}

// Unknown / garbage outcomes fall through to "other" (honest catch-all).
assertEqual(
  'unknown outcome "🛸 alien-ping" → other',
  mapOutcomeToDisposition("🛸 alien-ping"),
  "other",
);
assertEqual('empty outcome → other', mapOutcomeToDisposition(""), "other");

// ─── summarizeDispositions: counts always sum to total ──────────────────────
const allOutcomes = [...OUTREACH_CALL_OUTCOMES, ...CALL_RESULT_OUTCOMES];
const summary = summarizeDispositions(allOutcomes);
assertEqual(
  "summarize: total == number of outcomes fed in",
  summary.total,
  allOutcomes.length,
);
assertEqual(
  "summarize: disposition counts sum to total",
  DISPOSITION_CATEGORIES.reduce((acc, c) => acc + summary.breakdown[c], 0),
  summary.total,
);

// Empty input → all-zero breakdown, total 0.
const emptySummary = summarizeDispositions([]);
assertEqual("summarize empty: total 0", emptySummary.total, 0);
assertEqual(
  "summarize empty: every category is 0",
  emptySummary.breakdown,
  emptyDispositionBreakdown(),
);

// A handful of repeated outcomes still sums correctly.
const repeated = [
  ...OUTREACH_CALL_OUTCOMES,
  ...OUTREACH_CALL_OUTCOMES,
  "unknown-thing",
];
const repeatedSummary = summarizeDispositions(repeated);
assertEqual(
  "summarize repeated: counts sum to total (incl. the unknown→other)",
  DISPOSITION_CATEGORIES.reduce((acc, c) => acc + repeatedSummary.breakdown[c], 0),
  repeated.length,
);
assert(
  "summarize repeated: the unknown outcome lands in other",
  repeatedSummary.breakdown.other >= 1,
);

// ─── computeRemainingKpi = max(0, target − completed) ───────────────────────
assertEqual("remaining: 30 − 8 = 22", computeRemainingKpi(30, 8), 22);
assertEqual("remaining: exactly met → 0", computeRemainingKpi(15, 15), 0);
assertEqual("remaining: over target never negative", computeRemainingKpi(7, 20), 0);
assertEqual("remaining: zero target → 0", computeRemainingKpi(0, 5), 0);

// ─── aggregateTeamTotals == sum of member rows ──────────────────────────────
function makeMember(
  schedulerId: number,
  overrides: Partial<TeamMetricsMember> = {},
): TeamMetricsMember {
  const dispositions: DispositionBreakdown = {
    ...emptyDispositionBreakdown(),
    scheduled: 2,
    completed: 3,
    noAnswer: 1,
  };
  return {
    schedulerId,
    name: `Member ${schedulerId}`,
    facility: "Clinic A",
    userId: `u${schedulerId}`,
    workingToday: true,
    calendarStatus: "working",
    ptoToday: false,
    completedCallKpi: 30,
    scheduledKpi: 15,
    completedCalls: 6,
    dispositions,
    scheduledToday: 2,
    remainingCallKpi: 24,
    remainingScheduledKpi: 13,
    activeQueue: 10,
    carryover: 4,
    remainingCapacity: 26,
    ...overrides,
  };
}

const members: TeamMetricsMember[] = [
  makeMember(1),
  makeMember(2, { workingToday: false, ptoToday: true, calendarStatus: "pto" }),
  makeMember(3, { completedCalls: 0, dispositions: emptyDispositionBreakdown() }),
];

const totals = aggregateTeamTotals(members);

assertEqual("totals.members == member count", totals.members, members.length);
assertEqual(
  "totals.workingMembers == count of workingToday",
  totals.workingMembers,
  members.filter((m) => m.workingToday).length,
);

// Each numeric field equals the simple sum of the rows.
const sumField = (key: keyof TeamMetricsMember) =>
  members.reduce((acc, m) => acc + (m[key] as number), 0);

for (const key of [
  "completedCallKpi",
  "scheduledKpi",
  "completedCalls",
  "scheduledToday",
  "remainingCallKpi",
  "remainingScheduledKpi",
  "activeQueue",
  "carryover",
] as const) {
  assertEqual(`totals.${key} == sum of member rows`, totals[key], sumField(key));
}

// Disposition totals also fold per category.
for (const cat of DISPOSITION_CATEGORIES) {
  assertEqual(
    `totals.dispositions.${cat} == sum of member dispositions`,
    totals.dispositions[cat],
    members.reduce((acc, m) => acc + m.dispositions[cat], 0),
  );
}

// And the team disposition breakdown sums to total completed calls.
assertEqual(
  "totals: disposition breakdown sums to completedCalls",
  DISPOSITION_CATEGORIES.reduce((acc, c) => acc + totals.dispositions[c], 0),
  totals.completedCalls,
);

// Empty roster → all-zero totals, never a crash.
const emptyTotals = aggregateTeamTotals([]);
assertEqual("empty roster: 0 members", emptyTotals.members, 0);
assertEqual("empty roster: 0 completed calls", emptyTotals.completedCalls, 0);
assertEqual(
  "empty roster: zeroed disposition breakdown",
  emptyTotals.dispositions,
  emptyDispositionBreakdown(),
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Engagement Team Metrics assertions passed.");
