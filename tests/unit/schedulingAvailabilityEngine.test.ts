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
