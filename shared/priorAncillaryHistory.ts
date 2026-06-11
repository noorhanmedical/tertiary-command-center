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
): ReadonlyArray<AncillaryWarning> {
  const warnings: AncillaryWarning[] = [];
  for (const r of recommended) {
    const key = r.toLowerCase();
    const interval = ANCILLARY_RESTRICTED_INTERVAL_DAYS[key];
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
