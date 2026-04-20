import type { PatientScreening } from "@shared/schema";

export type InsuranceTier = 1 | 2 | 3;

export function insuranceTier(insurance: string | null | undefined): InsuranceTier {
  const s = (insurance || "").trim().toLowerCase();
  if (!s) return 3;
  // Strict per spec: straight Medicare = 1, PPO = 2, everything else
  // (HMO, Advantage, MAPD, commercial, Medicaid, etc.) = 3.
  const isMedicare = /\bmedicare\b/.test(s);
  const isAdvantageOrHmo = /(advantage|\bhmo\b|mapd|\bpart c\b)/.test(s);
  if (isMedicare && !isAdvantageOrHmo && !/\bppo\b/.test(s)) return 1;
  if (/\bppo\b/.test(s)) return 2;
  return 3;
}

const EXCLUDED_STATUSES = new Set([
  "scheduled",
  "completed",
  "declined",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
]);

export type EligibilityRejection = {
  eligible: false;
  reason:
    | "already_scheduled"
    | "declined"
    | "no_qualifying_tests"
    | "in_cooldown"
    | "no_phone"
    | "ineligible_status";
};
export type EligibilityAcceptance = { eligible: true };

export function isEligibleForCallList(
  patient: PatientScreening,
): EligibilityRejection | EligibilityAcceptance {
  const status = (patient.appointmentStatus || "").toLowerCase();
  if (status === "scheduled") return { eligible: false, reason: "already_scheduled" };
  if (status === "declined") return { eligible: false, reason: "declined" };
  if (EXCLUDED_STATUSES.has(status)) return { eligible: false, reason: "ineligible_status" };
  const qts = Array.isArray(patient.qualifyingTests) ? patient.qualifyingTests : [];
  if (qts.length === 0) return { eligible: false, reason: "no_qualifying_tests" };
  if (!patient.phoneNumber || !patient.phoneNumber.trim()) {
    return { eligible: false, reason: "no_phone" };
  }
  // Cooldown: if previousTests are listed and previousTestsDate is within
  // the cooldown window (6mo PPO / 12mo Medicare), exclude. We respect
  // the explicit "noPreviousTests" opt-out.
  if (!patient.noPreviousTests && patient.previousTestsDate) {
    const months = insuranceTier(patient.insurance) === 1 ? 12 : 6;
    const last = new Date(patient.previousTestsDate);
    if (!isNaN(last.getTime())) {
      const clears = new Date(last);
      clears.setMonth(clears.getMonth() + months);
      if (clears.getTime() > Date.now()) {
        return { eligible: false, reason: "in_cooldown" };
      }
    }
  }
  return { eligible: true };
}

export type VisitWindowStatus = "today" | "upcoming" | "past" | "unknown";

export function visitWindowStatus(
  scheduleDate: string | null | undefined,
  asOfDate: string,
): VisitWindowStatus {
  if (!scheduleDate) return "unknown";
  const d = scheduleDate.slice(0, 10);
  if (d === asOfDate) return "today";
  if (d > asOfDate) return "upcoming";
  return "past";
}

// Composite priority key — lower sorts first.
// Tier 1: visit patients with a visit in the next 30 days.
// Tier 2: outreach patients (or visit patients whose visit has passed).
export type PriorityInputs = {
  patientType: string;
  scheduleDate: string | null;
  insurance: string | null;
  qualifyingTests: string[] | null | undefined;
  asOfDate: string;
  daysAhead?: number; // default 30
};

export function priorityKey(p: PriorityInputs): {
  tier: 1 | 2;
  sort: [number, number, number, number];
} {
  const window = visitWindowStatus(p.scheduleDate, p.asOfDate);
  const tier: 1 | 2 = (p.patientType === "visit" && (window === "today" || window === "upcoming")) ? 1 : 2;
  const insurance = insuranceTier(p.insurance);
  const qtCount = Array.isArray(p.qualifyingTests) ? p.qualifyingTests.length : 0;

  if (tier === 1) {
    // Days from today to visit date — soonest first.
    const days = daysBetween(p.asOfDate, p.scheduleDate ?? p.asOfDate);
    return { tier, sort: [tier, days, insurance, -qtCount] };
  }
  // Tier 2 per spec: insurance tier first, then OLDEST last-contact age
  // (filled in by rankCandidates), then qualifying-test count as a final
  // tiebreak. Last-contact slot is left as 0 here and overwritten by the
  // ranker which has access to the contact map.
  return { tier, sort: [tier, insurance, 0, -qtCount] };
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime();
  const db = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime();
  if (isNaN(da) || isNaN(db)) return 9999;
  return Math.round((db - da) / 86_400_000);
}

export function comparePriority(
  a: ReturnType<typeof priorityKey>["sort"],
  b: ReturnType<typeof priorityKey>["sort"],
): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
