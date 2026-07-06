// Unit test for the Engagement Center manual-assignment coverage helpers.
// Run with `npx tsx script/testEngagementCoverageSuggestions.ts`. No DB needed —
// coverageRelation / sortSchedulersByCoverage / commonFacility are pure
// functions over SchedulerOption rows + a target facility.
//
// Asserts:
//   1. Roster-facility match → "home".
//   2. facilitiesCovered match → "covers".
//   3. Neither → "none".
//   4. Coverage comparison is trim/case-insensitive.
//   5. No facility → everyone "none" (fallback, no suggestions).
//   6. Sort orders home → covers → none, alphabetical within each tier.
//   7. Sort with no facility is plain alphabetical (no regression).
//   8. commonFacility returns the shared facility, or null when mixed/empty.

import {
  coverageRelation,
  sortSchedulersByCoverage,
  commonFacility,
  type SchedulerOption,
} from "../client/src/components/engagement/engagementShared";

type Assertion = { name: string; pass: boolean; detail: string };
const assertions: Assertion[] = [];
function record(name: string, pass: boolean, detail: string) {
  assertions.push({ name, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}  ${name} — ${detail}`);
}

const A: SchedulerOption = { id: 1, name: "Ashraful", facility: "Clinic A" };
const B: SchedulerOption = {
  id: 2,
  name: "Bianca",
  facility: "Clinic B",
  facilitiesCovered: ["Clinic A"],
};
const C: SchedulerOption = {
  id: 3,
  name: "Callista",
  facility: "Clinic C",
  facilitiesCovered: ["  clinic a  "],
};
const D: SchedulerOption = { id: 4, name: "Devon", facility: "Clinic C" };

function main() {
  record(
    "1 · roster-facility match → home",
    coverageRelation(A, "Clinic A") === "home",
    coverageRelation(A, "Clinic A"),
  );
  record(
    "2 · facilitiesCovered match → covers",
    coverageRelation(B, "Clinic A") === "covers",
    coverageRelation(B, "Clinic A"),
  );
  record(
    "3 · neither → none",
    coverageRelation(D, "Clinic A") === "none",
    coverageRelation(D, "Clinic A"),
  );
  record(
    "4 · coverage match is trim/case-insensitive",
    coverageRelation(C, "Clinic A") === "covers",
    coverageRelation(C, "Clinic A"),
  );
  record(
    "5 · no facility → none for everyone",
    coverageRelation(A, null) === "none" &&
      coverageRelation(B, "") === "none",
    `${coverageRelation(A, null)}/${coverageRelation(B, "")}`,
  );

  const ordered = sortSchedulersByCoverage([D, C, B, A], "Clinic A").map(
    (s) => s.id,
  );
  // A = home(0); B,C = covers(1) alphabetical → B then C; D = none(2).
  record(
    "6 · sort home → covers → none, alphabetical within tier",
    JSON.stringify(ordered) === JSON.stringify([1, 2, 3, 4]),
    `order=${ordered.join(",")}`,
  );

  const orderedNoFacility = sortSchedulersByCoverage([D, C, B, A], null).map(
    (s) => s.id,
  );
  // Plain alphabetical by name: Ashraful(1), Bianca(2), Callista(3), Devon(4).
  record(
    "7 · sort with no facility is plain alphabetical",
    JSON.stringify(orderedNoFacility) === JSON.stringify([1, 2, 3, 4]),
    `order=${orderedNoFacility.join(",")}`,
  );

  record(
    "8 · commonFacility shared vs mixed vs empty",
    commonFacility(["Clinic A", "Clinic A"]) === "Clinic A" &&
      commonFacility(["Clinic A", "Clinic B"]) === null &&
      commonFacility([null, undefined]) === null,
    `${commonFacility(["Clinic A", "Clinic A"])}/${commonFacility(["Clinic A", "Clinic B"])}/${commonFacility([null, undefined])}`,
  );

  const passed = assertions.filter((x) => x.pass).length;
  const failed = assertions.length - passed;
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`  assertions = passed ${passed}/${assertions.length}, failed ${failed}`);
  console.log("════════════════════════════════════════════════════════════");
  if (failed > 0) {
    console.error("[test:engagement-coverage-suggestions] FAIL");
    process.exit(1);
  }
  console.log("[test:engagement-coverage-suggestions] OK");
  process.exit(0);
}

main();
