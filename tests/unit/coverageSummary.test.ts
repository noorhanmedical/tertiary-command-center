// Unit test for the admin coverage-map inversion logic. Coverage semantics
// mirror the routing engine (server/services/schedulerAutoAssign.ts): an
// active member's home roster facility is primary coverage (counts by
// default), and facilitiesCovered is additive.
import assert from "node:assert/strict";
import {
  buildCoverage,
  type CoverageCoverer,
} from "../../client/src/components/engagement/CoverageSummary";
import type { CallSettingsMember } from "../../client/src/hooks/api/engagementCallSettings";

// Minimal builder — only the fields buildCoverage reads matter; the rest are
// filled with inert defaults so the CallSettingsMember type is satisfied.
function member(
  partial: Pick<CallSettingsMember, "schedulerId" | "name" | "facility"> &
    Partial<CallSettingsMember>,
): CallSettingsMember {
  return {
    userId: null,
    configured: true,
    team: "PCS",
    callWorkdayPercent: 100,
    visitPercent: null,
    baseCompletedCallKpi: 0,
    scheduledKpiPercent: 0,
    maxDailyCapacity: null,
    explicitCompletedKpi: null,
    explicitScheduledKpi: null,
    outreachPercent: null,
    facilitiesCovered: null,
    manualWorkingToday: null,
    active: true,
    completedCallKpi: 0,
    scheduledKpi: 0,
    visitTarget: 0,
    outreachTarget: 0,
    carryover: 0,
    remainingCapacity: 0,
    calendarWorkingToday: null,
    calendarStatus: "unavailable",
    ptoToday: false,
    manualOverrideActive: false,
    workingToday: false,
    ...partial,
  };
}

const find = (
  facilities: ReturnType<typeof buildCoverage>["facilities"],
  name: string,
) => facilities.find((f) => f.facility.toLowerCase() === name.toLowerCase());

const coverer = (c: CoverageCoverer) => ({ name: c.member.name, home: c.home });

async function main() {
  // 1. Home-facility default coverage: a member with no facilitiesCovered
  //    still covers their own roster facility (marked home).
  {
    const { facilities } = buildCoverage([
      member({ schedulerId: 1, name: "Alice", facility: "Clinic A" }),
    ]);
    const a = find(facilities, "Clinic A");
    assert.ok(a, "Clinic A should appear");
    assert.deepEqual(a!.coverers.map(coverer), [{ name: "Alice", home: true }]);
  }

  // 2. Additive cross-facility coverage: facilitiesCovered adds coverage
  //    beyond the home facility, marked non-home.
  {
    const { facilities } = buildCoverage([
      member({
        schedulerId: 1,
        name: "Alice",
        facility: "Clinic A",
        facilitiesCovered: ["Clinic B"],
      }),
    ]);
    const a = find(facilities, "Clinic A");
    const b = find(facilities, "Clinic B");
    assert.deepEqual(a!.coverers.map(coverer), [{ name: "Alice", home: true }]);
    assert.deepEqual(b!.coverers.map(coverer), [{ name: "Alice", home: false }]);
  }

  // 3. True zero-coverage gap detection: a facility only an INACTIVE member
  //    calls home is surfaced as a gap (no active coverer).
  {
    const { facilities } = buildCoverage([
      member({ schedulerId: 1, name: "Alice", facility: "Clinic A" }),
      member({
        schedulerId: 2,
        name: "Bob",
        facility: "Clinic B",
        active: false,
      }),
    ]);
    const b = find(facilities, "Clinic B");
    assert.ok(b, "Clinic B (inactive member's home) should still appear");
    assert.equal(b!.coverers.length, 0, "Clinic B should be a gap");
    // Gaps sort first.
    assert.equal(facilities[0].facility, "Clinic B");
  }

  // 4. Overlap + dedup: two members covering the same facility both show, and
  //    a member who lists their own home facility in facilitiesCovered is not
  //    duplicated (home wins).
  {
    const { facilities } = buildCoverage([
      member({
        schedulerId: 1,
        name: "Alice",
        facility: "Clinic A",
        facilitiesCovered: ["Clinic A", "Clinic B"],
      }),
      member({ schedulerId: 2, name: "Bob", facility: "Clinic B" }),
    ]);
    const a = find(facilities, "Clinic A");
    const b = find(facilities, "Clinic B");
    // Alice appears once on Clinic A, as home (not duplicated by the
    // redundant facilitiesCovered entry).
    assert.deepEqual(a!.coverers.map(coverer), [{ name: "Alice", home: true }]);
    // Clinic B covered by both Bob (home) and Alice (additive), sorted by name.
    assert.deepEqual(b!.coverers.map(coverer), [
      { name: "Alice", home: false },
      { name: "Bob", home: true },
    ]);
  }

  // 5. Case-insensitive grouping with first-seen label preserved, and blank
  //    entries ignored.
  {
    const { facilities } = buildCoverage([
      member({
        schedulerId: 1,
        name: "Alice",
        facility: "Clinic A",
        facilitiesCovered: ["clinic a", "  ", "Clinic C"],
      }),
    ]);
    const a = find(facilities, "Clinic A");
    assert.equal(a!.facility, "Clinic A", "first-seen label kept");
    assert.deepEqual(a!.coverers.map(coverer), [{ name: "Alice", home: true }]);
    assert.ok(find(facilities, "Clinic C"), "Clinic C present");
    assert.equal(
      facilities.filter((f) => f.facility.trim() === "").length,
      0,
      "blank facilities ignored",
    );
  }

  console.log("Coverage summary test passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
