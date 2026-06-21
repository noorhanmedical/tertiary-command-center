import type { Express } from "express";
import { storage } from "../storage";
import { canonicalDay } from "../services/scheduleDashboardService";
import { buildOutreachDashboard } from "../services/outreachService";
import type { BillingRecord } from "@shared/schema";

type ClinicHomeStat = {
  clinicKey: string;
  clinicLabel: string;
  patientCount: number;
  brainWaveCount: number;
  vitalWaveCount: number;
  ultrasoundCount: number;
  ancillaryCount: number;
  brainWaveValue: number;
  vitalWaveValue: number;
  ultrasoundValue: number;
  estimatedValue: number;
};

type AncillaryBucket = "brain" | "vital" | "ultrasound";

function clinicKeyFor(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

function bucketForTest(testName: string): AncillaryBucket {
  const normalized = String(testName).toLowerCase();
  if (normalized.includes("brain")) return "brain";
  if (normalized.includes("vital")) return "vital";
  return "ultrasound";
}

/**
 * Pick the most meaningful dollar figure off a billing record for an
 * estimated-reimbursement average. Prefers the contractually allowed amount,
 * then total charges, then whatever was actually paid. Returns null when the
 * record carries no usable monetary value.
 */
function reimbursementOf(record: BillingRecord): number | null {
  const toNum = (v: unknown): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };
  const allowed = toNum(record.allowedAmount);
  if (allowed > 0) return allowed;
  const charges = toNum(record.totalCharges);
  if (charges > 0) return charges;
  const paid =
    toNum(record.paidAmount) +
    toNum(record.insurancePaidAmount) +
    toNum(record.secondaryPaidAmount);
  if (paid > 0) return paid;
  return null;
}

/**
 * Build an estimated average reimbursement per ancillary bucket from existing
 * billing records. We reuse real billing data rather than hardcoding amounts;
 * any bucket without billing history simply has no estimate (0).
 */
function buildAvgReimbursementByBucket(
  records: BillingRecord[],
): Record<AncillaryBucket, number> {
  const sums: Record<AncillaryBucket, number> = { brain: 0, vital: 0, ultrasound: 0 };
  const counts: Record<AncillaryBucket, number> = { brain: 0, vital: 0, ultrasound: 0 };
  for (const record of records) {
    if (record.isTest) continue;
    const amount = reimbursementOf(record);
    if (amount == null) continue;
    const bucket = bucketForTest(record.service || "");
    sums[bucket] += amount;
    counts[bucket] += 1;
  }
  return {
    brain: counts.brain > 0 ? sums.brain / counts.brain : 0,
    vital: counts.vital > 0 ? sums.vital / counts.vital : 0,
    ultrasound: counts.ultrasound > 0 ? sums.ultrasound / counts.ultrasound : 0,
  };
}

/**
 * Lightweight home-page stats endpoint. Aggregates today's scheduled
 * ancillary activity across all clinics plus the number of outgoing calls
 * planned for today (the outreach daily call-list size).
 *
 * BrainWave / VitalWave are matched by name; every other qualifying test is
 * treated as an ultrasound (the remaining AI-qualified tests are all
 * duplex / doppler / echo ultrasounds per the product spec), so the three
 * counts always sum to the total ancillaries.
 */
export function registerHomeStatsRoutes(app: Express) {
  app.get("/api/home-stats", async (_req, res) => {
    try {
      const today = canonicalDay(new Date().toISOString());

      const batches = await storage.getAllScreeningBatches();
      const todaysBatches = batches.filter((b) => canonicalDay(b.scheduleDate) === today);

      // Estimated reimbursement per ancillary bucket, derived from real
      // billing history (not hardcoded). Used to attach a dollar value to
      // today's scheduled-ancillary counts.
      let avgReimbursement: Record<AncillaryBucket, number> = {
        brain: 0,
        vital: 0,
        ultrasound: 0,
      };
      try {
        const billingRecords = await storage.getAllBillingRecords();
        avgReimbursement = buildAvgReimbursementByBucket(billingRecords);
      } catch {
        // Estimates are best-effort; counts still render without them.
      }
      const estimatesAvailable =
        avgReimbursement.brain > 0 ||
        avgReimbursement.vital > 0 ||
        avgReimbursement.ultrasound > 0;

      const clinicMap = new Map<string, ClinicHomeStat>();
      let totalPatients = 0;
      let totalAncillaries = 0;
      let brainWaveTotal = 0;
      let vitalWaveTotal = 0;
      let ultrasoundTotal = 0;

      for (const batch of todaysBatches) {
        const label = (batch.facility || "").trim() || "Unassigned Facility";
        let entry = clinicMap.get(label);
        if (!entry) {
          entry = {
            clinicKey: clinicKeyFor(label),
            clinicLabel: label,
            patientCount: 0,
            brainWaveCount: 0,
            vitalWaveCount: 0,
            ultrasoundCount: 0,
            ancillaryCount: 0,
            brainWaveValue: 0,
            vitalWaveValue: 0,
            ultrasoundValue: 0,
            estimatedValue: 0,
          };
          clinicMap.set(label, entry);
        }

        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const patient of patients) {
          const tests = Array.isArray(patient.qualifyingTests)
            ? patient.qualifyingTests.filter(Boolean)
            : [];
          entry.patientCount += 1;
          totalPatients += 1;
          entry.ancillaryCount += tests.length;
          totalAncillaries += tests.length;

          for (const test of tests) {
            const bucket = bucketForTest(String(test));
            if (bucket === "brain") {
              entry.brainWaveCount += 1;
              brainWaveTotal += 1;
            } else if (bucket === "vital") {
              entry.vitalWaveCount += 1;
              vitalWaveTotal += 1;
            } else {
              entry.ultrasoundCount += 1;
              ultrasoundTotal += 1;
            }
          }
        }

        entry.brainWaveValue = entry.brainWaveCount * avgReimbursement.brain;
        entry.vitalWaveValue = entry.vitalWaveCount * avgReimbursement.vital;
        entry.ultrasoundValue = entry.ultrasoundCount * avgReimbursement.ultrasound;
        entry.estimatedValue =
          entry.brainWaveValue + entry.vitalWaveValue + entry.ultrasoundValue;
      }

      const clinics = Array.from(clinicMap.values()).sort((a, b) =>
        a.clinicLabel.localeCompare(b.clinicLabel),
      );

      // Outgoing calls planned today = the outreach daily call-list entries
      // whose schedule date is today. buildOutreachDashboard aggregates the
      // call list across a 90-day visit window, so card-level totals are NOT
      // today-only — we must filter each call-list entry by its scheduleDate.
      let callsPlannedToday = 0;
      try {
        const outreach = await buildOutreachDashboard(storage, today);
        callsPlannedToday = outreach.schedulerCards.reduce(
          (sum, card) =>
            sum +
            card.callList.filter((item) => canonicalDay(item.scheduleDate) === today)
              .length,
          0,
        );
      } catch {
        callsPlannedToday = 0;
      }

      const brainWaveValueTotal = brainWaveTotal * avgReimbursement.brain;
      const vitalWaveValueTotal = vitalWaveTotal * avgReimbursement.vital;
      const ultrasoundValueTotal = ultrasoundTotal * avgReimbursement.ultrasound;

      res.json({
        today,
        clinics,
        totals: {
          totalPatients,
          totalAncillaries,
          activeSchedules: todaysBatches.length,
          brainWaveCount: brainWaveTotal,
          vitalWaveCount: vitalWaveTotal,
          ultrasoundCount: ultrasoundTotal,
          brainWaveValue: brainWaveValueTotal,
          vitalWaveValue: vitalWaveValueTotal,
          ultrasoundValue: ultrasoundValueTotal,
          estimatedValue:
            brainWaveValueTotal + vitalWaveValueTotal + ultrasoundValueTotal,
        },
        estimatesAvailable,
        // Per-bucket availability so the UI annotates only buckets that have
        // real reimbursement history ($0 with no data would be misleading).
        valueAvailable: {
          brainWave: avgReimbursement.brain > 0,
          vitalWave: avgReimbursement.vital > 0,
          ultrasound: avgReimbursement.ultrasound > 0,
        },
        callsPlannedToday,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load home stats" });
    }
  });
}
