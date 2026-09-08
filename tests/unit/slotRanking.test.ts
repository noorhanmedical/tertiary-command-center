// Phase 6 — deterministic slot ranking (pure).
//
//   §1  only FEASIBLE (fits) slots are ranked — non-feasible never appear.
//   §2  no feasible slots → empty (never invents a slot).
//   §3  the single earliest feasible slot is tagged "Soonest available".
//   §4  a morning preference lifts an AM slot above a later PM slot.
//   §5  an afternoon preference lifts a PM slot.
//   §6  a preferred time yields a "requested time" reason.
//   §7  same-day existing visit adds "Same day as an existing visit".
//   §8  a multi-service one-visit fit surfaces "Completes A + B in one visit".
//   §9  output is deterministic + capped by limit; every reco has >=1 reason.
//
// Run: npx tsx tests/unit/slotRanking.test.ts

import assert from "node:assert";
import { rankSlots } from "../../shared/scheduling/slotRanking";
import type { SlotAvailability, VisitPlan } from "../../shared/scheduling/availabilityEngine";

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

function slot(time: string, fits: boolean): SlotAvailability {
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  return {
    time,
    startMinutes: h * 60 + m,
    available: fits ? 1 : 0,
    total: 1,
    fits,
    capacityFits: fits,
  };
}

const DATE = "2026-09-10";
const daySlots: SlotAvailability[] = [
  slot("08:00", true),
  slot("09:00", false), // full — must never be recommended
  slot("10:00", true),
  slot("13:00", true),
  slot("15:00", true),
];

check("§1 only feasible slots are ranked", () => {
  const out = rankSlots({ slots: daySlots, isoDate: DATE, limit: 10 });
  assert.ok(out.length === 4, `4 feasible, got ${out.length}`);
  assert.ok(!out.some((r) => r.time === "09:00"), "09:00 (full) must not appear");
});

check("§2 no feasible slots → empty (no invention)", () => {
  const out = rankSlots({ slots: [slot("08:00", false), slot("09:00", false)], isoDate: DATE });
  assert.deepStrictEqual(out, []);
});

check("§3 earliest feasible tagged 'Soonest available'", () => {
  const out = rankSlots({ slots: daySlots, isoDate: DATE });
  const earliest = out.find((r) => r.time === "08:00");
  assert.ok(earliest, "08:00 present");
  assert.ok(earliest!.reasons.includes("Soonest available"));
});

check("§4 morning preference lifts an AM slot to the top", () => {
  const out = rankSlots({ slots: daySlots, isoDate: DATE, preference: { partOfDay: "morning" } });
  assert.ok(partOfDay(out[0].startMinutes) === "morning", "top is AM");
  assert.ok(out[0].reasons.includes("Matches requested morning"));
});

check("§5 afternoon preference lifts a PM slot to the top", () => {
  const out = rankSlots({ slots: daySlots, isoDate: DATE, preference: { partOfDay: "afternoon" } });
  assert.ok(partOfDay(out[0].startMinutes) === "afternoon", "top is PM");
  assert.ok(out[0].reasons.includes("Matches requested afternoon"));
});

check("§6 preferred time yields a requested-time reason", () => {
  const out = rankSlots({ slots: daySlots, isoDate: DATE, preference: { preferredTime: "13:00" } });
  const match = out.find((r) => r.time === "13:00");
  assert.ok(match, "13:00 present");
  assert.ok(match!.reasons.some((r) => /requested time/i.test(r)), "requested-time reason");
});

check("§7 same-day existing visit adds a coordination reason", () => {
  const out = rankSlots({ slots: daySlots, isoDate: DATE, patientSameDayStartMinutes: [600] });
  assert.ok(out.every((r) => r.reasons.includes("Same day as an existing visit")));
});

check("§8 one-visit multi-service surfaces a combine reason", () => {
  const oneVisit: VisitPlan = {
    kind: "one_visit",
    steps: [
      { resourceType: "brainwave", isoDate: DATE, startMinutes: 780, endMinutes: 810, time: "13:00", serviceLabel: "BrainWave", offDay: false },
      { resourceType: "vitalwave", isoDate: DATE, startMinutes: 810, endMinutes: 840, time: "13:30", serviceLabel: "VitalWave", offDay: false },
    ],
    dates: [DATE],
    isoDate: DATE,
    startMinutes: 780,
    requiresOverride: false,
    reason: "fits",
    recommended: true,
  };
  const out = rankSlots({ slots: daySlots, isoDate: DATE, oneVisit });
  const combine = out.find((r) => r.startMinutes === 780);
  assert.ok(combine, "13:00 slot present");
  assert.ok(combine!.reasons.some((r) => /one visit/i.test(r)), "one-visit reason");
  // The one-visit slot should rank first (strongest factor).
  assert.strictEqual(out[0].startMinutes, 780);
});

check("§9 deterministic, capped, every reco has a reason", () => {
  const a = rankSlots({ slots: daySlots, isoDate: DATE, limit: 3 });
  const b = rankSlots({ slots: daySlots, isoDate: DATE, limit: 3 });
  assert.deepStrictEqual(a, b, "same inputs → same output");
  assert.ok(a.length === 3, "capped to 3");
  assert.ok(a.every((r) => r.reasons.length >= 1), "every reco has >=1 reason");
});

function partOfDay(startMinutes: number): "morning" | "afternoon" {
  return startMinutes < 720 ? "morning" : "afternoon";
}

if (failures > 0) {
  console.error(`slotRanking.test.ts: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("slotRanking.test.ts: all tests passed");
