// Prior ancillary history helper (Batch B14).
//
// Pure module shared by Admin Review + Plexus IQ. Decides when a
// recommended test would duplicate an existing entry in
// `patient_test_history`.

export type AncillaryTestName =
  | "BrainWave"
  | "VitalWave"
  | "Bilateral Carotid Duplex"
  | "Echocardiogram TTE"
  | "Renal Artery Doppler"
  | "Lower Extremity Arterial Doppler"
  | "Upper Extremity Arterial Doppler"
  | "Abdominal Aortic Aneurysm Duplex"
  | "Stress Echocardiogram"
  | "Lower Extremity Venous Duplex"
  | "Upper Extremity Venous Duplex"
  | string;

export const ANCILLARY_RESTRICTED_INTERVAL_DAYS: Record<string, number> = {
  // Default cooldown windows (in days) per restricted test. Admin
  // can extend / shorten via cooldown_records — this map is the
  // baseline used by the warning helper.
  "brainwave": 365,
  "vitalwave": 365,
  "bilateral carotid duplex": 365,
  "echocardiogram tte": 365,
  "renal artery doppler": 365,
  "lower extremity arterial doppler": 365,
  "upper extremity arterial doppler": 365,
  "abdominal aortic aneurysm duplex": 365,
  "stress echocardiogram": 365,
  "lower extremity venous duplex": 180,
  "upper extremity venous duplex": 180,
};

export type PriorTestEntry = {
  testName: AncillaryTestName;
  dateOfService: string | null;
  facility: string | null;
  source: string | null;
  notes: string | null;
};

export type AncillaryWarning = {
  testName: AncillaryTestName;
  reason: "duplicate_in_window" | "duplicate_outside_window";
  previousDate: string | null;
  intervalDays: number | null;
  message: string;
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function checkRecommendedTests(
  recommended: ReadonlyArray<AncillaryTestName>,
  priorTests: ReadonlyArray<PriorTestEntry>,
  now: Date = new Date(),
  intervalDaysOverride?: number | null,
): ReadonlyArray<AncillaryWarning> {
  const warnings: AncillaryWarning[] = [];
  for (const r of recommended) {
    const key = r.toLowerCase();
    // An explicit override (e.g. an insurance-derived cooldown window of
    // 180/365 days) takes priority. When no override is supplied we fall back
    // to the per-test defaults in ANCILLARY_RESTRICTED_INTERVAL_DAYS.
    const interval =
      typeof intervalDaysOverride === "number"
        ? intervalDaysOverride
        : ANCILLARY_RESTRICTED_INTERVAL_DAYS[key];
    const priorsForTest = priorTests.filter((p) => p.testName.toLowerCase() === key);
    if (priorsForTest.length === 0) continue;

    // Find the most recent prior.
    const mostRecent = priorsForTest
      .map((p) => ({ p, t: p.dateOfService ? new Date(p.dateOfService) : null }))
      .filter((x) => x.t && !Number.isNaN(x.t.getTime()))
      .sort((a, b) => (b.t!.getTime() - a.t!.getTime()))[0];
    if (!mostRecent) {
      warnings.push({
        testName: r,
        reason: "duplicate_outside_window",
        previousDate: null,
        intervalDays: interval ?? null,
        message: `Prior ${r} on file (date unknown)`,
      });
      continue;
    }
    const days = daysBetween(mostRecent.t!, now);
    if (interval == null) {
      warnings.push({
        testName: r,
        reason: "duplicate_outside_window",
        previousDate: mostRecent.p.dateOfService,
        intervalDays: null,
        message: `Prior ${r} on file (${mostRecent.p.dateOfService})`,
      });
      continue;
    }
    if (days < interval) {
      warnings.push({
        testName: r,
        reason: "duplicate_in_window",
        previousDate: mostRecent.p.dateOfService,
        intervalDays: interval,
        message: `${r} performed ${days} day(s) ago — within the ${interval}-day window`,
      });
    } else {
      warnings.push({
        testName: r,
        reason: "duplicate_outside_window",
        previousDate: mostRecent.p.dateOfService,
        intervalDays: interval,
        message: `${r} previously performed ${days} day(s) ago (outside the ${interval}-day window)`,
      });
    }
  }
  return warnings;
}

export function hasBlockingAncillaryWarning(warnings: ReadonlyArray<AncillaryWarning>): boolean {
  return warnings.some((w) => w.reason === "duplicate_in_window");
}

// ─── Insurance-derived cooldown window ──────────────────────────────
// Medicare patients are held for 12 months (365d); everyone else
// (PPO / commercial) for 6 months (180d). When the insurance is blank
// we return null so callers fall back to the per-test default map.
export function cooldownDaysForInsurance(
  insurance: string | null | undefined,
): number | null {
  const v = String(insurance ?? "").trim().toLowerCase();
  if (!v) return null;
  return v.includes("medicare") ? 365 : 180;
}

// ─── Canonical ancillary key resolution ─────────────────────────────
// Maps a UI test name (which may carry a CPT suffix, e.g.
// "Bilateral Carotid Duplex (93880)") to the lowercase key used by
// ANCILLARY_RESTRICTED_INTERVAL_DAYS ("bilateral carotid duplex").
export function canonicalAncillaryKey(name: string): string {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ") // strip CPT / parentheticals
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Ordered detection patterns for free-text prior-test parsing. More
// specific entries come first so that e.g. "stress echocardiogram" is
// consumed before the generic echocardiogram matcher can claim it.
const PRIOR_TEST_ALIAS_DEFS: ReadonlyArray<{ key: string; patterns: RegExp[] }> = [
  { key: "brainwave", patterns: [/brain\s*wave/, /\beeg\b/] },
  { key: "vitalwave", patterns: [/vital\s*wave/] },
  { key: "bilateral carotid duplex", patterns: [/carotid/] },
  { key: "renal artery doppler", patterns: [/renal/] },
  {
    key: "abdominal aortic aneurysm duplex",
    patterns: [/abdominal\s+aort/, /aortic\s+aneurysm/, /\baaa\b/],
  },
  {
    key: "upper extremity arterial doppler",
    patterns: [/upper\s+extremity\s+arterial/, /\bue\b[^.]*arterial/],
  },
  {
    key: "upper extremity venous duplex",
    patterns: [/upper\s+extremity\s+venous/, /\bue\b[^.]*venous/],
  },
  {
    key: "lower extremity arterial doppler",
    patterns: [/lower\s+extremity\s+arterial/, /\ble\b[^.]*arterial/],
  },
  {
    key: "lower extremity venous duplex",
    patterns: [/lower\s+extremity\s+venous/, /\ble\b[^.]*venous/],
  },
  { key: "stress echocardiogram", patterns: [/stress\s+echo\w*/] },
  { key: "echocardiogram tte", patterns: [/echocardiogram/, /\btte\b/, /\becho\b/] },
];

// Extract the first ISO-like (YYYY-MM-DD) or M/D/YYYY date from free text.
function firstDateInText(text: string): string | null {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Convert the free-text `previousTests` field into structured
 * PriorTestEntry objects whose `testName` matches the canonical keys in
 * ANCILLARY_RESTRICTED_INTERVAL_DAYS. Per-test dates are not reliably
 * present in the free text, so `previousTestsDate` (or the first date
 * found embedded in the text) is used as the date of service for every
 * detected entry.
 */
export function parsePreviousTests(
  previousTests: string | null | undefined,
  previousTestsDate: string | null | undefined,
): PriorTestEntry[] {
  const raw = String(previousTests ?? "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const date =
    (typeof previousTestsDate === "string" && previousTestsDate.trim()
      ? previousTestsDate.trim()
      : null) ?? firstDateInText(raw);

  let working = ` ${lower} `;
  const found: string[] = [];
  for (const def of PRIOR_TEST_ALIAS_DEFS) {
    let matched = false;
    for (const pattern of def.patterns) {
      const g = new RegExp(pattern.source, "g");
      if (g.test(working)) {
        matched = true;
        // Blank out the matched portions so a more generic pattern later
        // in the list can't re-claim the same text.
        working = working.replace(new RegExp(pattern.source, "g"), " ");
      }
    }
    if (matched) found.push(def.key);
  }

  return found.map((key) => ({
    testName: key,
    dateOfService: date,
    facility: null,
    source: "previousTests",
    notes: null,
  }));
}

/**
 * Given the list of addable ancillary UI names, return the subset that
 * is currently blocked by a within-window prior in the patient's
 * free-text history. The returned map is keyed by the original UI name
 * and carries the cooldown warning so the caller can surface a tooltip.
 */
export function blockedAncillariesFromHistory(
  uiTestNames: ReadonlyArray<string>,
  previousTests: string | null | undefined,
  previousTestsDate: string | null | undefined,
  insurance: string | null | undefined,
  now: Date = new Date(),
): Map<string, AncillaryWarning> {
  const priors = parsePreviousTests(previousTests, previousTestsDate);
  const out = new Map<string, AncillaryWarning>();
  if (priors.length === 0) return out;
  const overrideDays = cooldownDaysForInsurance(insurance);
  for (const uiName of uiTestNames) {
    const key = canonicalAncillaryKey(uiName);
    const warnings = checkRecommendedTests([key], priors, now, overrideDays);
    const blocking = warnings.find((w) => w.reason === "duplicate_in_window");
    if (blocking) out.set(uiName, { ...blocking, testName: uiName });
  }
  return out;
}
