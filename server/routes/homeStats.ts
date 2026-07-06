import type { Express } from "express";
import { storage } from "../storage";
import { canonicalDay } from "../services/scheduleDashboardService";
import { buildOutreachDashboard } from "../services/outreachService";
import type { PatientScreening } from "@shared/schema";

type AncillaryBucket = "brain" | "vital" | "ultrasound";

/** Aggregated counts for a single trailing time window. */
type WindowStat = {
  patients: number;
  ancillaries: number;
  activeSchedules: number;
  callsPlanned: number;
};

/** A single team member's logged-call count within a window. */
type MemberCallStat = {
  name: string;
  count: number;
};

function bucketForTest(testName: string): AncillaryBucket {
  const normalized = String(testName).toLowerCase();
  if (normalized.includes("brain")) return "brain";
  if (normalized.includes("vital")) return "vital";
  return "ultrasound";
}

/** Subtract whole days from a YYYY-MM-DD key, returning a new YYYY-MM-DD key. */
function dayKeyMinus(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Home-page "Today at a Glance" stats. Returns the four headline metrics
 * (patients, ancillaries, active schedules, calls planned) for today plus
 * trailing 7-day and 30-day windows (so each metric can be clicked to reveal
 * its recent history), a trailing 7-day ancillary breakdown, and a per-team-member
 * breakdown of logged outreach calls over the 7- and 30-day windows.
 *
 * Calls-planned note: the "today" value is forward-looking (patients on the
 * outreach call list scheduled for today), while the 7-/30-day window values
 * and the per-member breakdown reflect calls actually LOGGED (outreach_calls)
 * over those windows. Planned calls cannot be reconstructed for past days
 * (the call list is built from a forward 90-day classifier), so the client
 * labels the historical numbers as "calls logged" to keep the distinction
 * explicit rather than mixing two definitions under one label.
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
      const start7Key = dayKeyMinus(today, 6); // inclusive 7-day window
      const start30Key = dayKeyMinus(today, 29); // inclusive 30-day window
      // Forward-looking window: the next 7 days, strictly after today so it
      // never overlaps the trailing windows. Reads as "what's coming."
      const upcomingStartKey = dayKeyMinus(today, -1); // today + 1
      const upcomingEndKey = dayKeyMinus(today, -7); // today + 7

      const [batches, allPatients, billingRecords] = await Promise.all([
        storage.getAllScreeningBatches(),
        storage.getAllPatientScreenings(),
        storage.getAllBillingRecords(),
      ]);

      // Index active patients by batch so we can aggregate any window without
      // an N+1 query. Mirrors getPatientScreeningsByBatch (both filter active
      // rows only), so today's count is unchanged.
      const patientsByBatch = new Map<number, PatientScreening[]>();
      for (const p of allPatients) {
        const arr = patientsByBatch.get(p.batchId);
        if (arr) arr.push(p);
        else patientsByBatch.set(p.batchId, [p]);
      }

      const blank = (): WindowStat => ({
        patients: 0,
        ancillaries: 0,
        activeSchedules: 0,
        callsPlanned: 0,
      });
      const todayStat = blank();
      const last7 = blank();
      const last30 = blank();

      // Trailing 7-day ancillary breakdown (flat icon row) — matches the
      // 7-day default shown for the headline metrics.
      let brainWaveCount = 0;
      let vitalWaveCount = 0;
      let ultrasoundCount = 0;

      // Forward-looking next-7-day counters (additive to the historical tile).
      let upcomingAncillaryPatients = 0;
      let upcomingActiveSchedules = 0;
      // Per-category upcoming ancillary tallies (green numbers on the icon row).
      let brainWaveUpcoming = 0;
      let vitalWaveUpcoming = 0;
      let ultrasoundUpcoming = 0;

      for (const batch of batches) {
        const day = canonicalDay(batch.scheduleDate);
        if (!day) continue;
        const inToday = day === today;
        const in7 = day >= start7Key && day <= today;
        const in30 = day >= start30Key && day <= today;
        const inUpcoming = day >= upcomingStartKey && day <= upcomingEndKey;

        if (inUpcoming) {
          const upcomingPatients = patientsByBatch.get(batch.id) ?? [];
          upcomingActiveSchedules += 1;
          for (const patient of upcomingPatients) {
            const tests = Array.isArray(patient.qualifyingTests)
              ? patient.qualifyingTests.filter(Boolean)
              : [];
            if (tests.length > 0) upcomingAncillaryPatients += 1;
            for (const test of tests) {
              const bucket = bucketForTest(String(test));
              if (bucket === "brain") brainWaveUpcoming += 1;
              else if (bucket === "vital") vitalWaveUpcoming += 1;
              else ultrasoundUpcoming += 1;
            }
          }
        }

        if (!in30) continue; // outside every trailing window we care about

        const patients = patientsByBatch.get(batch.id) ?? [];
        let batchAncillaries = 0;
        for (const patient of patients) {
          const tests = Array.isArray(patient.qualifyingTests)
            ? patient.qualifyingTests.filter(Boolean)
            : [];
          batchAncillaries += tests.length;
          if (in7) {
            for (const test of tests) {
              const bucket = bucketForTest(String(test));
              if (bucket === "brain") brainWaveCount += 1;
              else if (bucket === "vital") vitalWaveCount += 1;
              else ultrasoundCount += 1;
            }
          }
        }

        if (in30) {
          last30.patients += patients.length;
          last30.ancillaries += batchAncillaries;
          last30.activeSchedules += 1;
        }
        if (in7) {
          last7.patients += patients.length;
          last7.ancillaries += batchAncillaries;
          last7.activeSchedules += 1;
        }
        if (inToday) {
          todayStat.patients += patients.length;
          todayStat.ancillaries += batchAncillaries;
          todayStat.activeSchedules += 1;
        }
      }

      // Outgoing calls planned today = the outreach daily call-list entries
      // whose schedule date is today. buildOutreachDashboard aggregates the
      // call list across a 90-day visit window, so card-level totals are NOT
      // today-only — we must filter each call-list entry by its scheduleDate.
      // Forward outreach call list for the next-7-day window: "distributed" =
      // upcoming call-list entries in the window; "done" = those already
      // touched (appointment status moved off "pending").
      let upcomingCallsDistributed = 0;
      let upcomingCallsDone = 0;
      try {
        const outreach = await buildOutreachDashboard(storage, today);
        todayStat.callsPlanned = outreach.schedulerCards.reduce(
          (sum, card) =>
            sum +
            card.callList.filter((item) => canonicalDay(item.scheduleDate) === today)
              .length,
          0,
        );
        for (const card of outreach.schedulerCards) {
          for (const item of card.callList) {
            const d = canonicalDay(item.scheduleDate);
            if (d >= upcomingStartKey && d <= upcomingEndKey) {
              upcomingCallsDistributed += 1;
              if ((item.appointmentStatus || "").toLowerCase() !== "pending") {
                upcomingCallsDone += 1;
              }
            }
          }
        }
      } catch {
        todayStat.callsPlanned = 0;
        upcomingCallsDistributed = 0;
        upcomingCallsDone = 0;
      }

      // Logged outreach calls over the trailing windows, plus a per-team-member
      // breakdown. These reflect actual calls made (outreach_calls), keyed by
      // the scheduler who logged them.
      let callsByMember7: MemberCallStat[] = [];
      let callsByMember30: MemberCallStat[] = [];
      try {
        const start = new Date(`${start30Key}T00:00:00.000Z`);
        const end = new Date(`${today}T23:59:59.999Z`);
        const start7 = new Date(`${start7Key}T00:00:00.000Z`);
        const [calls, users, schedulers] = await Promise.all([
          storage.listOutreachCallsInRange(start, end),
          storage.getAllUsers(),
          storage.getOutreachSchedulers(),
        ]);
        // Prefer the friendly scheduler display name tied to the user; fall
        // back to the account username. Keyed by user id so tallies never
        // collide on duplicate display names.
        const nameById = new Map<string, string>();
        for (const u of users) {
          if (u.username && u.username.trim()) nameById.set(u.id, u.username.trim());
        }
        for (const sc of schedulers) {
          if (sc.userId && sc.name && sc.name.trim()) {
            nameById.set(sc.userId, sc.name.trim());
          }
        }
        // Tally by stable id (userId, or a sentinel for unassigned calls) so
        // two members who happen to share a display name stay separate.
        const UNASSIGNED = "__unassigned__";
        const tally30 = new Map<string, number>();
        const tally7 = new Map<string, number>();
        for (const call of calls) {
          const key = call.schedulerUserId ?? UNASSIGNED;
          tally30.set(key, (tally30.get(key) ?? 0) + 1);
          if (call.startedAt >= start7) {
            tally7.set(key, (tally7.get(key) ?? 0) + 1);
          }
        }
        const labelFor = (key: string): string =>
          key === UNASSIGNED ? "Unassigned" : nameById.get(key) ?? "Unknown";
        const toSorted = (m: Map<string, number>): MemberCallStat[] =>
          Array.from(m.entries())
            .map(([key, count]) => ({ name: labelFor(key), count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        callsByMember7 = toSorted(tally7);
        callsByMember30 = toSorted(tally30);
        last7.callsPlanned = calls.filter((c) => c.startedAt >= start7).length;
        last30.callsPlanned = calls.length;
      } catch {
        callsByMember7 = [];
        callsByMember30 = [];
      }

      // Finance: collected (paidAmount) over the trailing 7-day window vs.
      // anticipated (totalCharges) over the upcoming 7-day window, keyed by
      // each billing record's dateOfService.
      let financeLast7 = 0;
      let financeUpcoming = 0;
      for (const rec of billingRecords) {
        const day = canonicalDay(rec.dateOfService ?? "");
        if (!day) continue;
        if (day >= start7Key && day <= today) {
          financeLast7 += Number(rec.paidAmount ?? 0) || 0;
        } else if (day >= upcomingStartKey && day <= upcomingEndKey) {
          financeUpcoming += Number(rec.totalCharges ?? 0) || 0;
        }
      }

      res.json({
        today,
        finance: {
          last7: financeLast7,
          upcoming: financeUpcoming,
        },
        windows: {
          today: todayStat,
          last7,
          last30,
        },
        upcoming: {
          ancillaryPatients: upcomingAncillaryPatients,
          activeSchedules: upcomingActiveSchedules,
          callsDistributed: upcomingCallsDistributed,
          callsDone: upcomingCallsDone,
        },
        ancillaryBreakdown: {
          brainWave: brainWaveCount,
          vitalWave: vitalWaveCount,
          ultrasound: ultrasoundCount,
          brainWaveUpcoming,
          vitalWaveUpcoming,
          ultrasoundUpcoming,
        },
        callsByMember: {
          last7: callsByMember7,
          last30: callsByMember30,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load home stats" });
    }
  });
}
