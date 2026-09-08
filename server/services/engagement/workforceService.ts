// Workforce availability + shift resolution (Phase 3).
//
// PURE decision core (no DB, no clock) so it is unit-testable, plus a thin
// DB-backed evaluate() wrapper. It layers a SHIFT dimension on top of the
// EXISTING whole-day working-today signal (resolveWorkingToday: manual > PTO >
// roster) and the EXISTING capacity model (computeCallTargets). It does NOT
// replace either — it feeds them.
//
// THREE SEPARATE CONCEPTS (kept distinct on purpose):
//   • PLANNED working today  — is the member scheduled to work this DATE?
//     (used by the 5 AM reconciliation; time-of-day irrelevant).
//   • REAL-TIME availability — can we assign NEW work RIGHT NOW? (within shift
//     window + availability state; used by live daytime distribution).
//   • CURRENT ownership       — which cases they already own (unchanged; lives
//     on patient_execution_cases.assignedTeamMemberId).
//
// OPT-IN: when no shift override AND no recurring default is configured, the
// shift dimension has NO opinion — behavior is identical to pre-Phase-3
// (available the whole working day, capacity from callWorkdayPercent).

import { WORKFORCE_AVAILABILITY_STATES, NON_ACCEPTING_AVAILABILITY_STATES, type WorkforceAvailabilityState } from "@shared/schema/workforceShifts";

/** Default productive-hours baseline a full-day KPI assumes (for proration). */
export const FULL_DAY_PRODUCTIVE_HOURS = Number(process.env.WORKFORCE_FULL_DAY_HOURS ?? 8);
/** Grace after shift start before inactivity may count as an unexpected no-show. */
export const SHIFT_START_GRACE_MINUTES = Number(process.env.WORKFORCE_SHIFT_START_GRACE_MIN ?? 45);
const DEFAULT_WORK_WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" → minutes since midnight, or null if malformed. */
export function hhmmToMinutes(v: string | null | undefined): number | null {
  if (!v || !HHMM_RE.test(v)) return null;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

export type ShiftWindow = {
  /** True when a real start/end time window applies (time-of-day gating). */
  hasWindow: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
};

export const NO_WINDOW: ShiftWindow = { hasWindow: false, startMinutes: null, endMinutes: null };

/** A validated shift window from raw HH:MM strings. Invalid (bad format or
 *  end <= start) → treated as NO window and flagged, so callers can fail safe
 *  without blocking the member entirely. */
export function buildShiftWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): { window: ShiftWindow; invalid: boolean } {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s == null && e == null) return { window: NO_WINDOW, invalid: false };
  if (s == null || e == null || e <= s) {
    // Partial or inverted window → invalid; do not gate on a broken window.
    return { window: NO_WINDOW, invalid: true };
  }
  return { window: { hasWindow: true, startMinutes: s, endMinutes: e }, invalid: false };
}

export type ShiftDayInputs = {
  /** Local weekday (0=Sun … 6=Sat) of the work date, in the clinic tz. */
  weekday: number;
  /** team_member_shifts row for the date, if any. */
  override: {
    working: boolean;
    shiftStart: string | null;
    shiftEnd: string | null;
    capacityOverride: number | null;
  } | null;
  /** Recurring default from engagement_call_settings. */
  defaultShiftStart: string | null;
  defaultShiftEnd: string | null;
  workWeekdays: number[] | null;
};

export type ShiftDay = {
  /** The shift dimension's opinion on whether the member works this DATE:
   *  true = scheduled on, false = scheduled off, null = no shift opinion. */
  shiftWorking: boolean | null;
  window: ShiftWindow;
  capacityOverride: number | null;
  invalidWindow: boolean;
  source: "override" | "recurring_default" | "none";
};

/**
 * Resolve the SHIFT dimension for a date: date-specific override wins over the
 * recurring default; neither present → no opinion (legacy behavior).
 */
export function resolveShiftDay(input: ShiftDayInputs): ShiftDay {
  if (input.override) {
    const { window, invalid } = buildShiftWindow(input.override.shiftStart, input.override.shiftEnd);
    return {
      shiftWorking: input.override.working,
      window: input.override.working ? window : NO_WINDOW,
      capacityOverride: input.override.capacityOverride,
      invalidWindow: input.override.working && invalid,
      source: "override",
    };
  }
  const hasDefault = !!(input.defaultShiftStart && input.defaultShiftEnd);
  if (hasDefault) {
    const weekdays = input.workWeekdays && input.workWeekdays.length > 0 ? input.workWeekdays : DEFAULT_WORK_WEEKDAYS;
    const scheduledToday = weekdays.includes(input.weekday);
    if (!scheduledToday) {
      return { shiftWorking: false, window: NO_WINDOW, capacityOverride: null, invalidWindow: false, source: "recurring_default" };
    }
    const { window, invalid } = buildShiftWindow(input.defaultShiftStart, input.defaultShiftEnd);
    return { shiftWorking: true, window, capacityOverride: null, invalidWindow: invalid, source: "recurring_default" };
  }
  return { shiftWorking: null, window: NO_WINDOW, capacityOverride: null, invalidWindow: false, source: "none" };
}

/**
 * PLANNED working today = the existing whole-day signal (manual > PTO > roster)
 * AND the shift dimension does not schedule the member OFF. The shift can only
 * REMOVE a day (scheduled off / day-off override); it never forces working
 * against a manual "off" or approved PTO (those already set legacyWorkingToday
 * false). Used by the 5 AM reconciliation — time-of-day is irrelevant here.
 */
export function resolvePlannedWorking(
  legacyWorkingToday: boolean,
  shiftWorking: boolean | null,
): boolean {
  if (!legacyWorkingToday) return false;
  return shiftWorking ?? true;
}

export type RealTimeAvailability = {
  acceptingNewWork: boolean;
  state: WorkforceAvailabilityState;
  reason?: string;
};

/**
 * REAL-TIME availability for NEW assignments (live daytime distribution).
 * Precedence: not-planned → off; explicit availability state → authoritative;
 * else derive from the shift window (inside = available, outside = off_shift);
 * no window → available all working day (legacy behavior).
 */
export function resolveRealTimeAvailability(input: {
  plannedWorking: boolean;
  window: ShiftWindow;
  nowLocalMinutes: number;
  availabilityState: WorkforceAvailabilityState | null;
}): RealTimeAvailability {
  if (!input.plannedWorking) {
    return { acceptingNewWork: false, state: "off_shift", reason: "not scheduled" };
  }
  const explicit = input.availabilityState;
  if (explicit && WORKFORCE_AVAILABILITY_STATES.includes(explicit)) {
    if (explicit === "available") return { acceptingNewWork: true, state: "available" };
    if ((NON_ACCEPTING_AVAILABILITY_STATES as readonly string[]).includes(explicit)) {
      return { acceptingNewWork: false, state: explicit, reason: explicit };
    }
  }
  if (input.window.hasWindow) {
    const within =
      input.nowLocalMinutes >= (input.window.startMinutes as number) &&
      input.nowLocalMinutes < (input.window.endMinutes as number);
    return within
      ? { acceptingNewWork: true, state: "available" }
      : { acceptingNewWork: false, state: "off_shift", reason: "outside shift window" };
  }
  // No window configured → available the whole working day (legacy behavior).
  return { acceptingNewWork: true, state: "available" };
}

/**
 * Fraction of a full day this shift represents, for capacity proration
 * (clamped 0..1). No window → 1 (no proration). A window >= FULL_DAY hours → 1.
 */
export function resolveShiftFraction(window: ShiftWindow, fullDayHours = FULL_DAY_PRODUCTIVE_HOURS): number {
  if (!window.hasWindow || window.startMinutes == null || window.endMinutes == null) return 1;
  const hours = (window.endMinutes - window.startMinutes) / 60;
  if (!(hours > 0) || !(fullDayHours > 0)) return 1;
  return Math.max(0, Math.min(1, hours / fullDayHours));
}

export type AbsenceEvaluation =
  | { evaluate: false; reason: string }
  | { evaluate: true; staleCutoffMs: number };

/**
 * Shift-aware absence-watch gating (pure). Decides whether a member should be
 * evaluated for a sudden-absence alert RIGHT NOW (in their clinic-local time)
 * and, if so, the effective inactivity cutoff (an absolute ms instant) beyond
 * which "no call since" counts as stale.
 *
 * Rules (in order):
 *   • not planned-working (manual/shift off)            → skip
 *   • explicit non-accepting availability (break /
 *     meeting / finish-current / unavailable / off_shift) → skip (intentional)
 *   • has a shift window:
 *       – before shiftStart + grace (ramp-up)           → skip
 *       – at/after shiftEnd                             → skip (legit end)
 *       – within                                        → evaluate; the stale
 *         cutoff is bounded at shift start so PRE-SHIFT silence never counts
 *         (mid-shift it is the rolling stale window).
 *   • no shift window (opt-in backward compat):
 *       – outside clinic-local business hours           → skip
 *       – within                                        → evaluate with the
 *         plain rolling stale window (pre-Phase-3 behavior, clinic-local).
 */
export function resolveAbsenceEvaluation(input: {
  plannedWorking: boolean;
  availabilityState: WorkforceAvailabilityState | null;
  window: ShiftWindow;
  nowLocalMinutes: number;
  nowMs: number;
  staleWindowMin: number;
  graceMin?: number;
  businessHourStart: number;
  businessHourEnd: number;
}): AbsenceEvaluation {
  if (!input.plannedWorking) return { evaluate: false, reason: "not_scheduled" };
  const s = input.availabilityState;
  if (s && (NON_ACCEPTING_AVAILABILITY_STATES as readonly string[]).includes(s)) {
    return { evaluate: false, reason: `availability_${s}` };
  }
  const grace = input.graceMin ?? SHIFT_START_GRACE_MINUTES;
  if (input.window.hasWindow) {
    const startM = input.window.startMinutes as number;
    const endM = input.window.endMinutes as number;
    if (input.nowLocalMinutes < startM + grace) return { evaluate: false, reason: "before_shift_grace" };
    if (input.nowLocalMinutes >= endM) return { evaluate: false, reason: "after_shift" };
    const minutesIntoShift = input.nowLocalMinutes - startM;
    const shiftStartInstant = input.nowMs - minutesIntoShift * 60_000;
    return {
      evaluate: true,
      staleCutoffMs: Math.max(input.nowMs - input.staleWindowMin * 60_000, shiftStartInstant),
    };
  }
  if (input.nowLocalMinutes < input.businessHourStart * 60 || input.nowLocalMinutes >= input.businessHourEnd * 60) {
    return { evaluate: false, reason: "outside_business_hours" };
  }
  return { evaluate: true, staleCutoffMs: input.nowMs - input.staleWindowMin * 60_000 };
}

/**
 * Capacity inputs for computeCallTargets, applying shift proration with the
 * required precedence:
 *   1. per-day capacityOverride  → explicit day KPI (NO proration)
 *   2. per-member explicitCompletedKpi → explicit KPI (NO proration)
 *   3. else callWorkdayPercent × shiftFraction (shift-derived proration on top
 *      of the admin's configured workday %; full day → unchanged)
 */
export function resolveCapacityInputs(input: {
  callWorkdayPercent: number;
  explicitCompletedKpi: number | null;
  capacityOverride: number | null;
  shiftFraction: number;
}): { callWorkdayPercent: number; explicitCompletedKpi: number | null } {
  if (input.capacityOverride != null && input.capacityOverride >= 0) {
    return { callWorkdayPercent: input.callWorkdayPercent, explicitCompletedKpi: Math.floor(input.capacityOverride) };
  }
  if (input.explicitCompletedKpi != null && input.explicitCompletedKpi >= 0) {
    return { callWorkdayPercent: input.callWorkdayPercent, explicitCompletedKpi: input.explicitCompletedKpi };
  }
  const eff = Math.max(0, Math.min(100, Math.round(input.callWorkdayPercent * input.shiftFraction)));
  return { callWorkdayPercent: eff, explicitCompletedKpi: null };
}
