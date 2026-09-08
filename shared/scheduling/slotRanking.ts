// Phase 6 — DETERMINISTIC slot ranking (pure).
//
// Ranks slots the canonical availabilityEngine already declared FEASIBLE. It
// NEVER invents availability: input slots come straight from computeSlots and
// only `fits` slots are ever ranked. No AI, no randomness — every result +
// explanation is a function of the inputs. The engine remains the single
// authority on WHAT is possible; this layer only orders WHICH feasible slot to
// recommend, with a fact-derived reason.
//
// Factors (all optional; a factor contributes ONLY when its structured data is
// actually present — no fabricated preferences):
//   • earliest feasible               → "Soonest available"
//   • stated morning/afternoon pref    → "Matches requested morning/afternoon"
//   • stated preferred time            → "Closest to the requested time"
//   • patient has a same-day visit     → "Same day as an existing visit"
//   • multi-service one-visit fit      → "Completes A + B in one visit"
// A feasible slot with no other signal is honestly labeled "Open time".

import type { SlotAvailability, VisitPlan } from "./availabilityEngine";

export type PartOfDay = "morning" | "afternoon";

export type SlotRankingInput = {
  /** Feasible-or-not slots for the PRIMARY service (from computeSlots). Only
   *  slots with fits === true are considered — never invented. */
  slots: SlotAvailability[];
  isoDate: string;
  /** Structured patient preference (only applied when present). */
  preference?: {
    partOfDay?: PartOfDay | null;
    /** "HH:MM" the patient asked for, if known. */
    preferredTime?: string | null;
  } | null;
  /** The patient's OWN existing appointment start-minutes on THIS date, if any
   *  (structured). Presence → a same-day-coordination bonus. */
  patientSameDayStartMinutes?: number[] | null;
  /** The engine's one-visit plan for a multi-service request, if feasible. When
   *  a slot's start aligns with it, surface the one-visit opportunity. */
  oneVisit?: VisitPlan | null;
  /** Max recommendations to return (default 3). */
  limit?: number;
};

export type RankedRecommendation = {
  time: string;
  startMinutes: number;
  isoDate: string;
  score: number;
  /** Fact-derived, human explanations (never opaque "AI recommends"). */
  reasons: string[];
};

const NOON_MINUTES = 12 * 60;

// Explicit, auditable factor weights. Higher = stronger recommendation.
const W_ONE_VISIT = 70;
const W_SAME_DAY = 60;
const W_PART_OF_DAY = 50;
const W_PREFERRED_TIME = 40;
// Earliness contributes a small, monotonic nudge so ties resolve to the
// soonest slot; it can never outweigh a real structured preference.
const W_EARLIEST_MAX = 20;

function partOfDayOf(startMinutes: number): PartOfDay {
  return startMinutes < NOON_MINUTES ? "morning" : "afternoon";
}

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Rank feasible slots deterministically. Returns up to `limit` recommendations
 * sorted by score DESC, tie-broken by EARLIER start (stable). Every result
 * carries at least one fact-derived reason.
 */
export function rankSlots(input: SlotRankingInput): RankedRecommendation[] {
  const feasible = input.slots
    .filter((s) => s.fits)
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes);
  if (feasible.length === 0) return [];

  const limit = input.limit ?? 3;
  const preferredMinutes =
    input.preference?.preferredTime != null ? hhmmToMinutes(input.preference.preferredTime) : null;
  const hasSameDay =
    Array.isArray(input.patientSameDayStartMinutes) && input.patientSameDayStartMinutes.length > 0;
  const oneVisitAligns = (startMinutes: number): boolean =>
    input.oneVisit != null &&
    input.oneVisit.isoDate === input.isoDate &&
    input.oneVisit.startMinutes === startMinutes;

  const oneVisitLabel = (): string | null => {
    if (!input.oneVisit || input.oneVisit.steps.length < 2) return null;
    const labels = input.oneVisit.steps.map((s) => s.serviceLabel);
    return labels.join(" + ");
  };

  const spanFirst = feasible[0].startMinutes;
  const spanLast = feasible[feasible.length - 1].startMinutes;
  const span = Math.max(1, spanLast - spanFirst);

  const scored: RankedRecommendation[] = feasible.map((slot, idx) => {
    const reasons: string[] = [];
    let score = 0;

    // Earliest (small monotonic nudge + explicit tag for the single soonest).
    const earliness = W_EARLIEST_MAX * (1 - (slot.startMinutes - spanFirst) / span);
    score += earliness;
    if (idx === 0) reasons.push("Soonest available");

    // Stated part-of-day preference.
    if (input.preference?.partOfDay && partOfDayOf(slot.startMinutes) === input.preference.partOfDay) {
      score += W_PART_OF_DAY;
      reasons.push(
        input.preference.partOfDay === "morning" ? "Matches requested morning" : "Matches requested afternoon",
      );
    }

    // Stated preferred time (closeness within the day).
    if (preferredMinutes != null) {
      const delta = Math.abs(slot.startMinutes - preferredMinutes);
      if (delta === 0) {
        score += W_PREFERRED_TIME;
        reasons.push("Matches the requested time");
      } else if (delta <= 60) {
        score += Math.round(W_PREFERRED_TIME * (1 - delta / 60));
        reasons.push("Close to the requested time");
      }
    }

    // Same-day coordination with the patient's own existing visit.
    if (hasSameDay) {
      score += W_SAME_DAY;
      reasons.push("Same day as an existing visit");
    }

    // Multi-service one-visit opportunity.
    if (oneVisitAligns(slot.startMinutes)) {
      const label = oneVisitLabel();
      score += W_ONE_VISIT;
      reasons.push(label ? `Completes ${label} in one visit` : "Completes all services in one visit");
    }

    if (reasons.length === 0) reasons.push("Open time");

    return { time: slot.time, startMinutes: slot.startMinutes, isoDate: input.isoDate, score, reasons };
  });

  scored.sort((a, b) => (b.score - a.score) || (a.startMinutes - b.startMinutes));
  return scored.slice(0, limit);
}
