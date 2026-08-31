import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  serviceDurationMinutes,
  concurrentOccupancy,
  machinesFreeAt,
  computeSlots,
  earliestFit,
  suggestSequences,
  conflictForRequest,
  findOverCapacityBlocks,
  isOperatingDay,
  nextEligibleOperatingDay,
  weekdayOf,
  planVisit,
  hhmmToMinutes,
  minutesToHHMM,
  type ExistingOccupancy,
  type CapacityByResource,
} from "../../shared/scheduling/availabilityEngine";
import { DEFAULT_RESOURCE_CAPACITY } from "../../shared/scheduling/capacityDefaults";

// Taylor defaults: BrainWave 2×45, VitalWave 2×30, Ultrasound 1×15/study, 5 turnover.
const CAP: CapacityByResource = {
  brainwave: { ...DEFAULT_RESOURCE_CAPACITY.brainwave },
  vitalwave: { ...DEFAULT_RESOURCE_CAPACITY.vitalwave },
  ultrasound: { ...DEFAULT_RESOURCE_CAPACITY.ultrasound },
};

const M = hhmmToMinutes;

function block(
  resourceType: ExistingOccupancy["resourceType"],
  start: string,
  end: string,
  patientKey: string,
  turnover = 0,
): ExistingOccupancy {
  return {
    resourceType,
    startMinutes: M(start),
    endMinutes: M(end),
    turnoverMinutes: turnover,
    patientKey,
  };
}

describe("serviceDurationMinutes", () => {
  it("uses configured duration for BrainWave / VitalWave", () => {
    assert.equal(serviceDurationMinutes({ resourceType: "brainwave" }, CAP), 45);
    assert.equal(serviceDurationMinutes({ resourceType: "vitalwave" }, CAP), 30);
  });

  it("multiplies ultrasound studies by minutes-per-study", () => {
    assert.equal(serviceDurationMinutes({ resourceType: "ultrasound", studyCount: 1 }, CAP), 15);
    assert.equal(serviceDurationMinutes({ resourceType: "ultrasound", studyCount: 4 }, CAP), 60);
    assert.equal(serviceDurationMinutes({ resourceType: "ultrasound", studyCount: 6 }, CAP), 90);
  });

  it("treats missing/zero ultrasound studyCount as one study", () => {
    assert.equal(serviceDurationMinutes({ resourceType: "ultrasound" }, CAP), 15);
    assert.equal(serviceDurationMinutes({ resourceType: "ultrasound", studyCount: 0 }, CAP), 15);
  });
});

describe("interval overlap concurrency", () => {
  it("counts two overlapping BrainWave blocks as 2 occupied", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:15", "10:00", "B"),
    ];
    // A candidate at 09:30 overlaps both.
    assert.equal(concurrentOccupancy("brainwave", M("09:30"), M("10:15"), existing, "C"), 2);
  });

  it("does not count non-overlapping blocks", () => {
    const existing = [block("brainwave", "09:00", "09:45", "A")];
    assert.equal(concurrentOccupancy("brainwave", M("10:00"), M("10:45"), existing, "C"), 0);
  });

  it("ignores blocks on other resource pools", () => {
    const existing = [block("vitalwave", "09:00", "09:30", "A")];
    assert.equal(concurrentOccupancy("brainwave", M("09:00"), M("09:45"), existing, "C"), 0);
  });
});

describe("machine-count capacity", () => {
  it("allows two simultaneous BrainWave (capacity 2)", () => {
    const existing = [block("brainwave", "09:00", "09:45", "A")];
    // Second overlapping still fits (1 machine free).
    assert.equal(machinesFreeAt("brainwave", M("09:00"), 45, CAP, existing, "B"), 1);
  });

  it("blocks a third overlapping BrainWave", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:00", "09:45", "B"),
    ];
    assert.equal(machinesFreeAt("brainwave", M("09:00"), 45, CAP, existing, "C"), 0);
  });

  it("keeps service pools independent (BrainWave full, VitalWave free)", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:00", "09:45", "B"),
    ];
    assert.equal(machinesFreeAt("brainwave", M("09:00"), 45, CAP, existing, "C"), 0);
    assert.equal(machinesFreeAt("vitalwave", M("09:00"), 30, CAP, existing, "C"), 2);
  });

  it("allows two VitalWave, blocks the third", () => {
    const two = [
      block("vitalwave", "09:00", "09:30", "A"),
      block("vitalwave", "09:00", "09:30", "B"),
    ];
    assert.equal(machinesFreeAt("vitalwave", M("09:00"), 30, CAP, two, "C"), 0);
  });
});

describe("computeSlots", () => {
  it("marks a fully-booked BrainWave time as not fitting", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:00", "09:45", "B"),
    ];
    const slots = computeSlots({ service: { resourceType: "brainwave" }, capacity: CAP, existing, candidatePatientKey: "C" });
    const at9 = slots.find((s) => s.time === "09:00")!;
    assert.equal(at9.fits, false);
    assert.equal(at9.available, 0);
    assert.equal(at9.total, 2);
    const at945 = slots.find((s) => s.time === "09:45")!;
    assert.equal(at945.fits, true);
    assert.equal(at945.available, 2);
  });
});

describe("ultrasound turnover between patients", () => {
  it("applies turnover ONLY between different patients", () => {
    // Patient A: 4 studies = 60 min, 09:00–10:00, turnover 5.
    const a = block("ultrasound", "09:00", "10:00", "A", 5);
    // A different patient at 10:00 must be blocked (turnover to 10:05).
    assert.equal(machinesFreeAt("ultrasound", M("10:00"), 15, CAP, [a], "B"), 0);
    // At 10:05 the machine is free for patient B.
    assert.equal(machinesFreeAt("ultrasound", M("10:05"), 15, CAP, [a], "B"), 1);
  });

  it("does NOT apply turnover within the same patient's continuous block", () => {
    // Same-patient adjacency: no turnover, so the machine is shared continuously.
    const a = block("ultrasound", "09:00", "10:00", "A", 5);
    // Same patient A continuing at 10:00 sees no turnover gap.
    assert.equal(machinesFreeAt("ultrasound", M("10:00"), 15, CAP, [a], "A"), 1);
  });

  it("6-study ultrasound is a continuous 90-minute block (no intra-study turnover)", () => {
    const dur = serviceDurationMinutes({ resourceType: "ultrasound", studyCount: 6 }, CAP);
    assert.equal(dur, 90);
    // 09:00 start → occupied 09:00–10:30, then 5 min turnover → next patient 10:35.
    const a: ExistingOccupancy = {
      resourceType: "ultrasound",
      startMinutes: M("09:00"),
      endMinutes: M("09:00") + dur,
      turnoverMinutes: 5,
      patientKey: "A",
    };
    assert.equal(minutesToHHMM(a.endMinutes), "10:30");
    assert.equal(machinesFreeAt("ultrasound", M("10:30"), 15, CAP, [a], "B"), 0);
    assert.equal(machinesFreeAt("ultrasound", M("10:35"), 15, CAP, [a], "B"), 1);
  });
});

describe("earliestFit + conflict", () => {
  it("reports the next available start when a slot is full", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:00", "09:45", "B"),
    ];
    const c = conflictForRequest({ resourceType: "brainwave" }, M("09:00"), CAP, existing, "C");
    assert.ok(c, "expected a conflict");
    // Earliest fit is the start of the day (08:00) since it's free before 09:00.
    assert.equal(c!.nextAvailableMinutes, M("08:00"));
  });

  it("returns null (no conflict) when a machine is free", () => {
    const existing = [block("brainwave", "09:00", "09:45", "A")];
    assert.equal(conflictForRequest({ resourceType: "brainwave" }, M("09:00"), CAP, existing, "C"), null);
  });
});

describe("multi-service sequencing suggestions", () => {
  it("produces sequential blocks for BrainWave + VitalWave (no overlap for same patient)", () => {
    const s = suggestSequences({
      services: [{ resourceType: "brainwave" }, { resourceType: "vitalwave" }],
      capacity: CAP,
      existing: [],
      candidatePatientKey: "P",
    });
    assert.ok(s.length >= 1);
    const first = s[0];
    // Two steps, second starts at/after the first ends.
    assert.equal(first.steps.length, 2);
    assert.ok(first.steps[1].startMinutes >= first.steps[0].endMinutes);
    assert.equal(first.recommended, true);
    assert.ok(first.reason.length > 0);
  });

  it("offers a reversed 2-service option", () => {
    const s = suggestSequences({
      services: [{ resourceType: "brainwave" }, { resourceType: "vitalwave" }],
      capacity: CAP,
      existing: [],
      candidatePatientKey: "P",
    });
    // Deterministic: distinct orderings surface as distinct step plans.
    const orders = s.map((x) => x.steps.map((st) => st.resourceType).join(">"));
    assert.ok(orders.includes("brainwave>vitalwave"));
  });
});

describe("findOverCapacityBlocks (machine outage)", () => {
  it("flags appointments that exceed a reduced capacity", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:00", "09:45", "B"),
    ];
    // Reduced to 1 machine → both 09:00 blocks are over capacity.
    const impacted = findOverCapacityBlocks("brainwave", 1, existing);
    assert.equal(impacted.length, 2);
  });

  it("flags nothing when demand fits the reduced capacity", () => {
    const existing = [block("brainwave", "09:00", "09:45", "A")];
    assert.equal(findOverCapacityBlocks("brainwave", 1, existing).length, 0);
  });
});

// ─── Operating days ──────────────────────────────────────────────────────

// 2027-03-15 Mon, -16 Tue, -17 Wed, -18 Thu, -19 Fri, -20 Sat, -21 Sun.
describe("operating-day evaluation", () => {
  it("weekdayOf returns the local day-of-week", () => {
    assert.equal(weekdayOf("2027-03-15"), 1); // Monday
    assert.equal(weekdayOf("2027-03-16"), 2); // Tuesday
    assert.equal(weekdayOf("2027-03-18"), 4); // Thursday
  });

  it("isOperatingDay honors the resource's configured weekdays", () => {
    // Ultrasound default = Tue/Thu.
    assert.equal(isOperatingDay("ultrasound", "2027-03-16", CAP), true); // Tue
    assert.equal(isOperatingDay("ultrasound", "2027-03-15", CAP), false); // Mon
    assert.equal(isOperatingDay("ultrasound", "2027-03-18", CAP), true); // Thu
    // BrainWave = Mon–Fri.
    assert.equal(isOperatingDay("brainwave", "2027-03-15", CAP), true); // Mon
    assert.equal(isOperatingDay("brainwave", "2027-03-21", CAP), false); // Sun
  });

  it("computeSlots classifies an off-day (capacity free but not a service day)", () => {
    const slots = computeSlots({
      service: { resourceType: "ultrasound", studyCount: 1 },
      capacity: CAP,
      existing: [],
      candidatePatientKey: "C",
      isoDate: "2027-03-15", // Monday — ultrasound off-day
    });
    const s = slots.find((x) => x.time === "09:00")!;
    assert.equal(s.capacityFits, true, "machine is free");
    assert.equal(s.fits, false, "but not a recommendation on an off-day");
    assert.equal(s.constraint, "off_day");
  });

  it("computeSlots recommends on an operating day", () => {
    const slots = computeSlots({
      service: { resourceType: "ultrasound", studyCount: 1 },
      capacity: CAP,
      existing: [],
      candidatePatientKey: "C",
      isoDate: "2027-03-16", // Tuesday — ultrasound operating day
    });
    const s = slots.find((x) => x.time === "09:00")!;
    assert.equal(s.fits, true);
    assert.equal(s.constraint, undefined);
  });
});

describe("nextEligibleOperatingDay", () => {
  it("returns the NEXT eligible day, not blindly tomorrow", () => {
    // From Monday, ultrasound's next normal day is Tuesday (not Wed).
    assert.equal(
      nextEligibleOperatingDay(["ultrasound"], "2027-03-15", CAP, { inclusive: false }),
      "2027-03-16",
    );
    // From Tuesday (exclusive), the next ultrasound day is Thursday.
    assert.equal(
      nextEligibleOperatingDay(["ultrasound"], "2027-03-16", CAP, { inclusive: false }),
      "2027-03-18",
    );
  });

  it("respects the intersection of MULTIPLE resources' days", () => {
    // BrainWave (Mon–Fri) + Ultrasound (Tue/Thu) → next shared day from Monday
    // is Tuesday.
    assert.equal(
      nextEligibleOperatingDay(["brainwave", "ultrasound"], "2027-03-15", CAP, { inclusive: true }),
      "2027-03-16",
    );
  });

  it("inclusive=true returns the day itself when it already qualifies", () => {
    assert.equal(
      nextEligibleOperatingDay(["ultrasound"], "2027-03-16", CAP, { inclusive: true }),
      "2027-03-16",
    );
  });
});

// ─── Visit planning: one-visit vs split-visit ────────────────────────────

describe("planVisit — one-visit preference", () => {
  it("places BrainWave + Ultrasound in ONE visit on the earliest shared day", () => {
    const { oneVisit, splitVisit } = planVisit({
      services: [{ resourceType: "brainwave" }, { resourceType: "ultrasound", studyCount: 2 }],
      capacity: CAP,
      existingByDate: {},
      candidatePatientKey: "P",
      isoDate: "2027-03-15", // Monday — ultrasound off; one-visit should move to Tue
    });
    assert.ok(oneVisit, "expected a one-visit plan");
    assert.equal(oneVisit!.kind, "one_visit");
    assert.equal(oneVisit!.isoDate, "2027-03-16"); // Tuesday (both offered)
    assert.equal(oneVisit!.recommended, true);
    // Two steps, sequential (patient in one machine at a time).
    assert.equal(oneVisit!.steps.length, 2);
    assert.ok(oneVisit!.steps[1].startMinutes >= oneVisit!.steps[0].endMinutes);
    // A split alternative is also offered (BrainWave Mon, Ultrasound Tue).
    assert.ok(splitVisit, "expected a split-visit alternative");
    assert.ok(splitVisit!.dates.length >= 2);
  });

  it("single-resource visit stays one-visit with no split", () => {
    const { oneVisit, splitVisit } = planVisit({
      services: [{ resourceType: "brainwave" }],
      capacity: CAP,
      existingByDate: {},
      candidatePatientKey: "P",
      isoDate: "2027-03-15", // Monday — brainwave operates
    });
    assert.ok(oneVisit);
    assert.equal(oneVisit!.isoDate, "2027-03-15");
    assert.equal(splitVisit, null);
  });

  it("same operating days → one-visit only (no split needed)", () => {
    // BrainWave + VitalWave both Mon–Fri.
    const { oneVisit, splitVisit } = planVisit({
      services: [{ resourceType: "brainwave" }, { resourceType: "vitalwave" }],
      capacity: CAP,
      existingByDate: {},
      candidatePatientKey: "P",
      isoDate: "2027-03-16",
    });
    assert.ok(oneVisit);
    assert.equal(oneVisit!.dates.length, 1);
    assert.equal(splitVisit, null);
  });
});

describe("split-visit multi-date structure", () => {
  it("split plan places each resource on its OWN operating day (distinct dates)", () => {
    const { splitVisit } = planVisit({
      services: [{ resourceType: "brainwave" }, { resourceType: "ultrasound", studyCount: 1 }],
      capacity: CAP,
      existingByDate: {},
      candidatePatientKey: "P",
      isoDate: "2027-03-15", // Monday
    });
    assert.ok(splitVisit, "expected a split plan");
    // BrainWave step on a Mon–Fri day; ultrasound step on a Tue/Thu day.
    const bw = splitVisit!.steps.find((s) => s.resourceType === "brainwave")!;
    const us = splitVisit!.steps.find((s) => s.resourceType === "ultrasound")!;
    assert.ok(bw && us);
    // Each lands on an operating day for its own resource.
    assert.equal(isOperatingDay("brainwave", bw.isoDate, CAP), true);
    assert.equal(isOperatingDay("ultrasound", us.isoDate, CAP), true);
    // The two services are on different dates (that's the point of a split).
    assert.notEqual(bw.isoDate, us.isoDate);
    // dates[] reflects the distinct dates, sorted.
    assert.deepEqual(splitVisit!.dates, Array.from(new Set([bw.isoDate, us.isoDate])).sort());
  });

  it("grouping split steps by date yields one group per date", () => {
    const { splitVisit } = planVisit({
      services: [{ resourceType: "brainwave" }, { resourceType: "ultrasound", studyCount: 2 }],
      capacity: CAP,
      existingByDate: {},
      candidatePatientKey: "P",
      isoDate: "2027-03-15",
    });
    assert.ok(splitVisit);
    // Mirror the client's group-by-date transform used for the write payload.
    const byDate: Record<string, number> = {};
    for (const s of splitVisit!.steps) byDate[s.isoDate] = (byDate[s.isoDate] ?? 0) + 1;
    assert.equal(Object.keys(byDate).length, splitVisit!.dates.length);
    // Every step is accounted for in exactly one date group.
    const total = Object.values(byDate).reduce((a, b) => a + b, 0);
    assert.equal(total, splitVisit!.steps.length);
  });
});

describe("conflictForRequest — off-day vs full", () => {
  it("names an off_day conflict + next eligible day", () => {
    const c = conflictForRequest(
      { resourceType: "ultrasound", studyCount: 1 },
      hhmmToMinutes("09:00"),
      CAP,
      [],
      "C",
      "2027-03-15", // Monday off-day
    );
    assert.ok(c);
    assert.equal(c!.constraint, "off_day");
    assert.equal(c!.nextEligibleDay, "2027-03-16");
    assert.equal(c!.nextAvailableMinutes, null);
  });

  it("names a full conflict on a normal day with same-day next opening", () => {
    const existing = [
      block("brainwave", "09:00", "09:45", "A"),
      block("brainwave", "09:00", "09:45", "B"),
    ];
    const c = conflictForRequest(
      { resourceType: "brainwave" },
      hhmmToMinutes("09:00"),
      CAP,
      existing,
      "C",
      "2027-03-16", // Tuesday — brainwave normal day
    );
    assert.ok(c);
    assert.equal(c!.constraint, "full");
    assert.equal(c!.nextAvailableMinutes, hhmmToMinutes("08:00"));
  });

  it("no conflict on a normal day with capacity", () => {
    assert.equal(
      conflictForRequest({ resourceType: "brainwave" }, hhmmToMinutes("09:00"), CAP, [], "C", "2027-03-16"),
      null,
    );
  });
});
