import type { Express } from "express";
import { storage } from "../storage";
import { canonicalDay } from "../services/scheduleDashboardService";
import { buildOutreachDashboard } from "../services/outreachService";

type ClinicHomeStat = {
  clinicKey: string;
  clinicLabel: string;
  patientCount: number;
  brainWaveCount: number;
  vitalWaveCount: number;
  ultrasoundCount: number;
  ancillaryCount: number;
};

function clinicKeyFor(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
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
            const normalized = String(test).toLowerCase();
            if (normalized.includes("brain")) {
              entry.brainWaveCount += 1;
              brainWaveTotal += 1;
            } else if (normalized.includes("vital")) {
              entry.vitalWaveCount += 1;
              vitalWaveTotal += 1;
            } else {
              entry.ultrasoundCount += 1;
              ultrasoundTotal += 1;
            }
          }
        }
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
        },
        callsPlannedToday,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load home stats" });
    }
  });
}
