// Unit test for facilitiesCovered-aware scheduler routing.
// Run with `npx tsx script/testFacilityCoverageRouting.ts`. No DATABASE_URL needed —
// pickSchedulerForFacility is a pure function over scheduler rows + a
// schedulerId → facilitiesCovered map.
//
// Asserts:
//   1. Direct roster-facility match still wins (no regression) and is NOT
//      reported as a coverage match.
//   2. With no direct match, a member who covers the facility via
//      facilitiesCovered is routed the work (facilityMatched + coverageMatched).
//   3. Direct match beats a coverage-only match for the same facility.
//   4. Coverage comparison is trim/case-insensitive.
//   5. Members with no coverage configured fall back to the cross-facility
//      capacity pick (current behavior — no regression).
//   6. No facilityId → cross-facility fallback by capacity.

import { pickSchedulerForFacility } from "../server/services/schedulerAutoAssign";
import type { OutreachScheduler } from "@shared/schema/outreach";

type Assertion = { name: string; pass: boolean; detail: string };
const assertions: Assertion[] = [];
function record(name: string, pass: boolean, detail: string): void {
  assertions.push({ name, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}  ${name} — ${detail}`);
}

function scheduler(
  id: number,
  facility: string,
  capacityPercent: number,
): OutreachScheduler {
  // Only the fields pickSchedulerForFacility reads must be real; the rest are
  // filled with plausible defaults to satisfy the type.
  return {
    id,
    name: `Member ${id}`,
    facility,
    userId: `user-${id}`,
    capacityPercent,
    dailyTarget: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as OutreachScheduler;
}

function main(): void {
  const a = scheduler(1, "Clinic A", 100);
  const b = scheduler(2, "Clinic B", 80);
  const c = scheduler(3, "Clinic C", 90);

  // 1. Direct roster-facility match wins, coverageMatched=false.
  const r1 = pickSchedulerForFacility([a, b, c], "Clinic B", new Map());
  record(
    "1 · direct roster-facility match wins and is not a coverage match",
    r1?.scheduler.id === 2 && r1?.facilityMatched === true && r1?.coverageMatched === false,
    `picked=${r1?.scheduler.id} facilityMatched=${r1?.facilityMatched} coverageMatched=${r1?.coverageMatched}`,
  );

  // 2. No direct match → covered member is routed the work.
  const coverage2 = new Map<number, string[]>([[3, ["Clinic Z"]]]);
  const r2 = pickSchedulerForFacility([a, b, c], "Clinic Z", coverage2);
  record(
    "2 · coverage match routes work when no direct facility match",
    r2?.scheduler.id === 3 && r2?.facilityMatched === true && r2?.coverageMatched === true,
    `picked=${r2?.scheduler.id} facilityMatched=${r2?.facilityMatched} coverageMatched=${r2?.coverageMatched}`,
  );

  // 3. Direct match beats a coverage-only match for the same facility.
  //    Member b covers Clinic A (lower capacity), member a IS Clinic A.
  const coverage3 = new Map<number, string[]>([[2, ["Clinic A"]]]);
  const r3 = pickSchedulerForFacility([a, b, c], "Clinic A", coverage3);
  record(
    "3 · direct roster-facility match beats a coverage-only match",
    r3?.scheduler.id === 1 && r3?.coverageMatched === false,
    `picked=${r3?.scheduler.id} coverageMatched=${r3?.coverageMatched}`,
  );

  // 4. Coverage comparison is trim/case-insensitive.
  const coverage4 = new Map<number, string[]>([[2, ["  clinic z "]]]);
  const r4 = pickSchedulerForFacility([a, b, c], "Clinic Z", coverage4);
  record(
    "4 · coverage comparison is trim/case-insensitive",
    r4?.scheduler.id === 2 && r4?.coverageMatched === true,
    `picked=${r4?.scheduler.id} coverageMatched=${r4?.coverageMatched}`,
  );

  // 5. No coverage configured + no direct match → cross-facility fallback by
  //    capacity (current behavior). Highest capacity = a (100).
  const r5 = pickSchedulerForFacility([a, b, c], "Clinic Z", new Map());
  record(
    "5 · no coverage configured falls back to cross-facility capacity pick",
    r5?.scheduler.id === 1 && r5?.facilityMatched === false && r5?.coverageMatched === false,
    `picked=${r5?.scheduler.id} facilityMatched=${r5?.facilityMatched} coverageMatched=${r5?.coverageMatched}`,
  );

  // 6. No facilityId → cross-facility fallback by capacity.
  const r6 = pickSchedulerForFacility([b, c], null, new Map());
  record(
    "6 · null facility → highest-capacity fallback",
    r6?.scheduler.id === 3 && r6?.facilityMatched === false,
    `picked=${r6?.scheduler.id} facilityMatched=${r6?.facilityMatched}`,
  );

  // 7. Among multiple covering members, highest capacity wins.
  const coverage7 = new Map<number, string[]>([
    [2, ["Clinic Z"]],
    [3, ["Clinic Z"]],
  ]);
  const r7 = pickSchedulerForFacility([b, c], "Clinic Z", coverage7);
  record(
    "7 · among covering members, highest capacity wins",
    r7?.scheduler.id === 3 && r7?.coverageMatched === true,
    `picked=${r7?.scheduler.id} capacity=${r7?.scheduler.capacityPercent}`,
  );

  const passed = assertions.filter((x) => x.pass).length;
  const failed = assertions.length - passed;
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`  assertions = passed ${passed}/${assertions.length}, failed ${failed}`);
  console.log("════════════════════════════════════════════════════════════");
  if (failed > 0) {
    console.error("[test:facility-coverage-routing] FAIL");
    process.exit(1);
  }
  console.log("[test:facility-coverage-routing] OK");
  process.exit(0);
}

main();
