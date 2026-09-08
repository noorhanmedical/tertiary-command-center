// Phase 3 — workforce shift + availability PURE logic. DB-free, deterministic.
// Run: npx tsx tests/unit/workforceShifts.test.ts
//
// Covers the decision core that distribution, capacity, and the absence watcher
// all read: shift-window resolution, planned vs real-time gating, capacity
// proration precedence, shift fraction, and the shift-aware absence gate.

import assert from "node:assert/strict";
import {
  hhmmToMinutes,
  buildShiftWindow,
  resolveShiftDay,
  resolvePlannedWorking,
  resolveRealTimeAvailability,
  resolveShiftFraction,
  resolveCapacityInputs,
  resolveAbsenceEvaluation,
  NO_WINDOW,
  FULL_DAY_PRODUCTIVE_HOURS,
} from "../../server/services/engagement/workforceService";

const MON = 1;
const SUN = 0;
const SAT = 6;

async function main() {
  // ── hhmmToMinutes ─────────────────────────────────────────────────────────
  assert.equal(hhmmToMinutes("00:00"), 0);
  assert.equal(hhmmToMinutes("09:30"), 570);
  assert.equal(hhmmToMinutes("23:59"), 1439);
  assert.equal(hhmmToMinutes("24:00"), null, "24:00 invalid");
  assert.equal(hhmmToMinutes("9:30"), null, "non-zero-padded invalid");
  assert.equal(hhmmToMinutes("garbage"), null);
  assert.equal(hhmmToMinutes(null), null);
  assert.equal(hhmmToMinutes(undefined), null);

  // ── buildShiftWindow ──────────────────────────────────────────────────────
  {
    const both = buildShiftWindow("09:00", "17:00");
    assert.deepEqual(both.window, { hasWindow: true, startMinutes: 540, endMinutes: 1020 });
    assert.equal(both.invalid, false);

    const none = buildShiftWindow(null, null);
    assert.equal(none.window.hasWindow, false, "no times → no window");
    assert.equal(none.invalid, false, "no times is NOT invalid (opt-in)");

    const partial = buildShiftWindow("09:00", null);
    assert.equal(partial.window.hasWindow, false, "partial → no window");
    assert.equal(partial.invalid, true, "partial window flagged invalid");

    const inverted = buildShiftWindow("17:00", "09:00");
    assert.equal(inverted.window.hasWindow, false, "inverted → no window");
    assert.equal(inverted.invalid, true, "inverted window flagged invalid");

    const equal = buildShiftWindow("09:00", "09:00");
    assert.equal(equal.invalid, true, "zero-length window invalid");
  }

  // ── resolveShiftDay: OVERRIDE wins ────────────────────────────────────────
  {
    const on = resolveShiftDay({
      weekday: SUN, // even on a non-work weekday, an explicit working override applies
      override: { working: true, shiftStart: "10:00", shiftEnd: "14:00", capacityOverride: 25 },
      defaultShiftStart: "09:00", defaultShiftEnd: "17:00", workWeekdays: [1, 2, 3, 4, 5],
    });
    assert.equal(on.shiftWorking, true);
    assert.equal(on.source, "override");
    assert.deepEqual(on.window, { hasWindow: true, startMinutes: 600, endMinutes: 840 });
    assert.equal(on.capacityOverride, 25);

    const off = resolveShiftDay({
      weekday: MON,
      override: { working: false, shiftStart: null, shiftEnd: null, capacityOverride: null },
      defaultShiftStart: "09:00", defaultShiftEnd: "17:00", workWeekdays: [1, 2, 3, 4, 5],
    });
    assert.equal(off.shiftWorking, false, "day-off override → scheduled off");
    assert.equal(off.window.hasWindow, false, "off day has no window");

    // Invalid override window while working → flagged, treated as NO window.
    const bad = resolveShiftDay({
      weekday: MON,
      override: { working: true, shiftStart: "17:00", shiftEnd: "09:00", capacityOverride: null },
      defaultShiftStart: null, defaultShiftEnd: null, workWeekdays: null,
    });
    assert.equal(bad.shiftWorking, true);
    assert.equal(bad.invalidWindow, true, "inverted override flagged");
    assert.equal(bad.window.hasWindow, false, "inverted → no gating window (fail-safe)");
  }

  // ── resolveShiftDay: RECURRING DEFAULT ────────────────────────────────────
  {
    const workday = resolveShiftDay({
      weekday: MON, override: null,
      defaultShiftStart: "08:00", defaultShiftEnd: "16:00", workWeekdays: [1, 2, 3, 4, 5],
    });
    assert.equal(workday.shiftWorking, true, "Mon is a work weekday");
    assert.equal(workday.source, "recurring_default");
    assert.deepEqual(workday.window, { hasWindow: true, startMinutes: 480, endMinutes: 960 });

    const weekend = resolveShiftDay({
      weekday: SAT, override: null,
      defaultShiftStart: "08:00", defaultShiftEnd: "16:00", workWeekdays: [1, 2, 3, 4, 5],
    });
    assert.equal(weekend.shiftWorking, false, "Sat not in workWeekdays → off");
    assert.equal(weekend.window.hasWindow, false);

    // Null workWeekdays defaults to Mon–Fri.
    const defWeekdays = resolveShiftDay({
      weekday: SUN, override: null,
      defaultShiftStart: "08:00", defaultShiftEnd: "16:00", workWeekdays: null,
    });
    assert.equal(defWeekdays.shiftWorking, false, "Sun off under default Mon–Fri");
  }

  // ── resolveShiftDay: NONE (opt-in backward compat) ────────────────────────
  {
    const none = resolveShiftDay({
      weekday: MON, override: null,
      defaultShiftStart: null, defaultShiftEnd: null, workWeekdays: null,
    });
    assert.equal(none.shiftWorking, null, "no shift model → no opinion");
    assert.equal(none.source, "none");
    assert.equal(none.window.hasWindow, false);
    // A lone default start without an end is NOT a usable default → none.
    const halfDefault = resolveShiftDay({
      weekday: MON, override: null,
      defaultShiftStart: "09:00", defaultShiftEnd: null, workWeekdays: null,
    });
    assert.equal(halfDefault.shiftWorking, null, "incomplete default → no opinion");
  }

  // ── resolvePlannedWorking: shift can only REMOVE a day ────────────────────
  assert.equal(resolvePlannedWorking(false, true), false, "manual/PTO off wins over shift-on");
  assert.equal(resolvePlannedWorking(false, null), false);
  assert.equal(resolvePlannedWorking(true, null), true, "no shift opinion → legacy working");
  assert.equal(resolvePlannedWorking(true, true), true);
  assert.equal(resolvePlannedWorking(true, false), false, "shift day-off removes the day");

  // ── resolveRealTimeAvailability ───────────────────────────────────────────
  const win = buildShiftWindow("09:00", "17:00").window; // 540..1020
  {
    // Not planned → off.
    const r = resolveRealTimeAvailability({ plannedWorking: false, window: win, nowLocalMinutes: 600, availabilityState: null });
    assert.equal(r.acceptingNewWork, false);
    assert.equal(r.state, "off_shift");

    // Within window, no explicit state → available.
    const within = resolveRealTimeAvailability({ plannedWorking: true, window: win, nowLocalMinutes: 600, availabilityState: null });
    assert.equal(within.acceptingNewWork, true);
    assert.equal(within.state, "available");

    // Before window → off_shift.
    const before = resolveRealTimeAvailability({ plannedWorking: true, window: win, nowLocalMinutes: 480, availabilityState: null });
    assert.equal(before.acceptingNewWork, false);
    assert.equal(before.state, "off_shift");

    // At end boundary (exclusive) → off_shift.
    const atEnd = resolveRealTimeAvailability({ plannedWorking: true, window: win, nowLocalMinutes: 1020, availabilityState: null });
    assert.equal(atEnd.acceptingNewWork, false, "end is exclusive");

    // Explicit on_break beats an in-window clock.
    const onBreak = resolveRealTimeAvailability({ plannedWorking: true, window: win, nowLocalMinutes: 600, availabilityState: "on_break" });
    assert.equal(onBreak.acceptingNewWork, false);
    assert.equal(onBreak.state, "on_break");

    // Explicit available beats an out-of-window clock (manual override).
    const forcedAvail = resolveRealTimeAvailability({ plannedWorking: true, window: win, nowLocalMinutes: 60, availabilityState: "available" });
    assert.equal(forcedAvail.acceptingNewWork, true);

    // No window + planned → available all working day (legacy).
    const noWin = resolveRealTimeAvailability({ plannedWorking: true, window: NO_WINDOW, nowLocalMinutes: 60, availabilityState: null });
    assert.equal(noWin.acceptingNewWork, true, "no window → available whole working day");
  }

  // ── resolveShiftFraction ──────────────────────────────────────────────────
  assert.equal(resolveShiftFraction(NO_WINDOW), 1, "no window → no proration");
  assert.equal(resolveShiftFraction(buildShiftWindow("09:00", "17:00").window), 1, "8h == full day → 1");
  assert.equal(resolveShiftFraction(buildShiftWindow("09:00", "13:00").window), 0.5, "4h → 0.5");
  assert.equal(resolveShiftFraction(buildShiftWindow("09:00", "21:00").window), 1, "12h clamps to 1");
  assert.equal(resolveShiftFraction(buildShiftWindow("09:00", "11:00").window), 0.25, "2h → 0.25");
  assert.equal(FULL_DAY_PRODUCTIVE_HOURS, 8, "documented baseline");

  // ── resolveCapacityInputs: precedence override > explicitKpi > proration ──
  {
    // capacityOverride wins, floored, KPI path (callWorkdayPercent untouched).
    const a = resolveCapacityInputs({ callWorkdayPercent: 100, explicitCompletedKpi: 40, capacityOverride: 22, shiftFraction: 0.5 });
    assert.equal(a.explicitCompletedKpi, 22, "capacityOverride wins as explicit KPI");
    assert.equal(a.callWorkdayPercent, 100, "override does not prorate the workday %");

    // No override → explicit member KPI wins (no proration).
    const b = resolveCapacityInputs({ callWorkdayPercent: 100, explicitCompletedKpi: 40, capacityOverride: null, shiftFraction: 0.5 });
    assert.equal(b.explicitCompletedKpi, 40, "explicit member KPI preserved");
    assert.equal(b.callWorkdayPercent, 100, "explicit KPI is NOT prorated");

    // Neither → prorate callWorkdayPercent by the shift fraction.
    const c = resolveCapacityInputs({ callWorkdayPercent: 100, explicitCompletedKpi: null, capacityOverride: null, shiftFraction: 0.5 });
    assert.equal(c.callWorkdayPercent, 50, "half-day shift → 50% workday");
    assert.equal(c.explicitCompletedKpi, null);

    // Full-day fraction leaves the workday % unchanged.
    const d = resolveCapacityInputs({ callWorkdayPercent: 80, explicitCompletedKpi: null, capacityOverride: null, shiftFraction: 1 });
    assert.equal(d.callWorkdayPercent, 80, "full day → unchanged");

    // capacityOverride of 0 is a valid explicit KPI (>= 0), not ignored.
    const e = resolveCapacityInputs({ callWorkdayPercent: 100, explicitCompletedKpi: null, capacityOverride: 0, shiftFraction: 1 });
    assert.equal(e.explicitCompletedKpi, 0, "capacityOverride 0 honored (day off calls)");
  }

  // ── resolveAbsenceEvaluation (shift-aware absence gate) ───────────────────
  const NOW_MS = Date.parse("2026-06-15T16:00:00Z"); // arbitrary anchor
  const STALE = 90;
  const base = { nowMs: NOW_MS, staleWindowMin: STALE, businessHourStart: 9, businessHourEnd: 17 };
  const shift9to17 = buildShiftWindow("09:00", "17:00").window; // 540..1020
  {
    // Not planned working → skip.
    const s1 = resolveAbsenceEvaluation({ ...base, plannedWorking: false, availabilityState: null, window: shift9to17, nowLocalMinutes: 600 });
    assert.equal(s1.evaluate, false);
    assert.equal((s1 as { reason: string }).reason, "not_scheduled");

    // Explicit break → skip (intentional, not a surprise absence).
    const s2 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: "on_break", window: shift9to17, nowLocalMinutes: 600 });
    assert.equal(s2.evaluate, false);
    assert.equal((s2 as { reason: string }).reason, "availability_on_break");

    // Before shift start + grace (grace 45; 09:00+45 = 09:45 = 585) → skip.
    const s3 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: null, window: shift9to17, nowLocalMinutes: 580, graceMin: 45 });
    assert.equal(s3.evaluate, false);
    assert.equal((s3 as { reason: string }).reason, "before_shift_grace");

    // At/after shift end (1020) → skip (legitimate end of shift).
    const s4 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: null, window: shift9to17, nowLocalMinutes: 1020 });
    assert.equal(s4.evaluate, false);
    assert.equal((s4 as { reason: string }).reason, "after_shift");

    // Just past grace, early in shift → evaluate; cutoff BOUNDED at shift start
    // (pre-shift silence must not count). At 09:50 (590), 50 min into shift,
    // shiftStartInstant = now - 50m; that's LATER than now-90m, so cutoff = shiftStart.
    const s5 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: null, window: shift9to17, nowLocalMinutes: 590, graceMin: 45 });
    assert.equal(s5.evaluate, true);
    const expectedShiftStart = NOW_MS - 50 * 60_000;
    assert.equal((s5 as { staleCutoffMs: number }).staleCutoffMs, expectedShiftStart, "cutoff bounded at shift start early in shift");

    // Deep into shift (13:00 = 780, 240 min in) → rolling 90-min window applies
    // (now-90m is later than shift start), so cutoff = now-90m.
    const s6 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: null, window: shift9to17, nowLocalMinutes: 780, graceMin: 45 });
    assert.equal(s6.evaluate, true);
    assert.equal((s6 as { staleCutoffMs: number }).staleCutoffMs, NOW_MS - STALE * 60_000, "mid-shift → rolling stale window");

    // No shift window (opt-in): outside clinic-local business hours → skip.
    const s7 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: null, window: NO_WINDOW, nowLocalMinutes: 8 * 60 });
    assert.equal(s7.evaluate, false);
    assert.equal((s7 as { reason: string }).reason, "outside_business_hours");

    // No shift window, within business hours → evaluate with plain rolling window.
    const s8 = resolveAbsenceEvaluation({ ...base, plannedWorking: true, availabilityState: null, window: NO_WINDOW, nowLocalMinutes: 12 * 60 });
    assert.equal(s8.evaluate, true);
    assert.equal((s8 as { staleCutoffMs: number }).staleCutoffMs, NOW_MS - STALE * 60_000, "no-shift → pre-Phase-3 rolling window");
  }

  console.log("workforceShifts unit test: all checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
