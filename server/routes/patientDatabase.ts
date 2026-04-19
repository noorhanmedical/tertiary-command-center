import type { Express } from "express";
import { storage } from "../storage";
import { patientKey, encodePatientKey, decodePatientKey, normalizePatientName, normalizeDob } from "../lib/patientKey";
import { computeCooldowns, groupHistoryByPatient, type TestCooldownEntry } from "../services/cooldownCanonical";
import type { PatientScreening, PatientTestHistory, GeneratedNote, ScreeningBatch } from "@shared/schema";

const UNASSIGNED = "Unassigned";

type RosterPatient = {
  key: string;
  encodedKey: string;
  name: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phoneNumber: string | null;
  insurance: string | null;
  clinic: string;
  lastVisit: string | null;
  testCount: number;
  screeningCount: number;
  generatedNoteCount: number;
  cooldownActiveCount: number;
  nextCooldownClearsAt: string | null;
  daysUntilNextClear: number | null;
};

type ClinicGroup = {
  clinic: string;
  patients: RosterPatient[];
};

type DashboardCounts = {
  oneDay: number;
  oneWeek: number;
  oneMonth: number;
  totals: { patients: number; clinics: number };
  byClinic: Array<{ clinic: string; oneDay: number; oneWeek: number; oneMonth: number }>;
};

function bestScreening(screenings: PatientScreening[]): PatientScreening {
  return [...screenings].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt - at;
  })[0];
}

function clinicOf(s: PatientScreening, batchById: Map<number, ScreeningBatch>): string {
  return s.facility || batchById.get(s.batchId)?.facility || UNASSIGNED;
}

function summarizeCooldowns(entries: TestCooldownEntry[]): {
  active: number;
  nextClears: string | null;
  daysUntilNextClear: number | null;
} {
  const active = entries.filter((e) => !e.cleared);
  if (active.length === 0) return { active: 0, nextClears: null, daysUntilNextClear: null };
  const next = active[0]; // already sorted by clearsAt asc
  return { active: active.length, nextClears: next.clearsAt, daysUntilNextClear: next.daysUntilClear };
}

export function registerPatientDatabaseRoutes(app: Express) {
  app.get("/api/patients/database", async (req, res) => {
    try {
      const search = String(req.query.search || "").trim().toLowerCase();
      const clinicFilter = String(req.query.clinic || "").trim();
      const cooldownWindow = String(req.query.cooldownWindow || "").trim(); // "1d" | "1w" | "1m"

      const [batches, allTestHistory, allNotes] = await Promise.all([
        storage.getAllScreeningBatches(),
        storage.getAllTestHistory(),
        storage.getAllGeneratedNotes(),
      ]);
      const batchById = new Map(batches.map((b) => [b.id, b] as const));

      // Collect all patient screenings by walking each batch (parallel-batched).
      const allScreenings: PatientScreening[] = [];
      await Promise.all(
        batches.map(async (b) => {
          const ps = await storage.getPatientScreeningsByBatch(b.id);
          for (const p of ps) allScreenings.push(p);
        }),
      );

      // Index test history & generated notes by patient key.
      const historyByKey = groupHistoryByPatient(allTestHistory);
      const notesByPatientId = new Map<number, GeneratedNote[]>();
      for (const n of allNotes) {
        const arr = notesByPatientId.get(n.patientId);
        if (arr) arr.push(n);
        else notesByPatientId.set(n.patientId, [n]);
      }

      // Group screenings by canonical key.
      const screeningsByKey = new Map<string, PatientScreening[]>();
      for (const s of allScreenings) {
        const k = patientKey(s.name, s.dob);
        const arr = screeningsByKey.get(k);
        if (arr) arr.push(s);
        else screeningsByKey.set(k, [s]);
      }

      const now = new Date();
      const ONE_DAY = 1, ONE_WEEK = 7, ONE_MONTH = 30;

      const groupsMap = new Map<string, RosterPatient[]>();

      for (const [key, screenings] of Array.from(screeningsByKey.entries())) {
        const primary = bestScreening(screenings);
        const clinic = clinicOf(primary, batchById);

        // Search filter
        if (search) {
          const hay = `${primary.name} ${primary.dob || ""}`.toLowerCase();
          if (!hay.includes(search)) continue;
        }
        if (clinicFilter && clinic !== clinicFilter) continue;

        const history = historyByKey.get(key) ?? [];
        const cooldowns = computeCooldowns(history, now);
        const cdSummary = summarizeCooldowns(cooldowns);

        // Cooldown window filter
        if (cooldownWindow) {
          const limit = cooldownWindow === "1d" ? ONE_DAY : cooldownWindow === "1w" ? ONE_WEEK : cooldownWindow === "1m" ? ONE_MONTH : null;
          if (limit === null) continue;
          const inWindow = cooldowns.some((e) => !e.cleared && e.daysUntilClear <= limit);
          if (!inWindow) continue;
        }

        const noteCount = screenings.reduce((acc, s) => acc + (notesByPatientId.get(s.id)?.length ?? 0), 0);

        // Compute last visit from screenings (use batch.scheduleDate if present, else createdAt date).
        let lastVisit: string | null = null;
        for (const s of screenings) {
          const b = batchById.get(s.batchId);
          const d = b?.scheduleDate || (s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : null);
          if (d && (!lastVisit || d > lastVisit)) lastVisit = d;
        }

        const roster: RosterPatient = {
          key,
          encodedKey: encodePatientKey(key),
          name: primary.name,
          dob: primary.dob ?? null,
          age: primary.age ?? null,
          gender: primary.gender ?? null,
          phoneNumber: primary.phoneNumber ?? null,
          insurance: primary.insurance ?? null,
          clinic,
          lastVisit,
          testCount: history.length,
          screeningCount: screenings.length,
          generatedNoteCount: noteCount,
          cooldownActiveCount: cdSummary.active,
          nextCooldownClearsAt: cdSummary.nextClears,
          daysUntilNextClear: cdSummary.daysUntilNextClear,
        };

        const arr = groupsMap.get(clinic);
        if (arr) arr.push(roster);
        else groupsMap.set(clinic, [roster]);
      }

      const groups: ClinicGroup[] = Array.from(groupsMap.entries())
        .map(([clinic, patients]) => ({
          clinic,
          patients: patients.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => {
          if (a.clinic === UNASSIGNED) return 1;
          if (b.clinic === UNASSIGNED) return -1;
          return a.clinic.localeCompare(b.clinic);
        });

      const totalPatients = groups.reduce((s, g) => s + g.patients.length, 0);
      res.json({ groups, totals: { patients: totalPatients, clinics: groups.length } });
    } catch (error: any) {
      console.error("[patient-database/list] error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/patients/database/cooldown-summary", async (_req, res) => {
    try {
      const [batches, allTestHistory] = await Promise.all([
        storage.getAllScreeningBatches(),
        storage.getAllTestHistory(),
      ]);
      const batchById = new Map(batches.map((b) => [b.id, b] as const));
      const allScreenings: PatientScreening[] = [];
      await Promise.all(
        batches.map(async (b) => {
          const ps = await storage.getPatientScreeningsByBatch(b.id);
          for (const p of ps) allScreenings.push(p);
        }),
      );

      const historyByKey = groupHistoryByPatient(allTestHistory);
      const screeningsByKey = new Map<string, PatientScreening[]>();
      for (const s of allScreenings) {
        const k = patientKey(s.name, s.dob);
        const arr = screeningsByKey.get(k);
        if (arr) arr.push(s);
        else screeningsByKey.set(k, [s]);
      }

      const now = new Date();
      const counts: DashboardCounts = {
        oneDay: 0,
        oneWeek: 0,
        oneMonth: 0,
        totals: { patients: 0, clinics: 0 },
        byClinic: [],
      };
      const clinicCounts = new Map<string, { oneDay: number; oneWeek: number; oneMonth: number }>();

      for (const [key, screenings] of Array.from(screeningsByKey.entries())) {
        const primary = bestScreening(screenings);
        const clinic = clinicOf(primary, batchById);
        const history = historyByKey.get(key) ?? [];
        if (history.length === 0) continue;
        const cooldowns = computeCooldowns(history, now);
        const active = cooldowns.filter((e) => !e.cleared);
        if (active.length === 0) continue;
        const next = active[0].daysUntilClear;
        const bucket = clinicCounts.get(clinic) || { oneDay: 0, oneWeek: 0, oneMonth: 0 };
        if (next <= 1) { counts.oneDay++; bucket.oneDay++; }
        if (next <= 7) { counts.oneWeek++; bucket.oneWeek++; }
        if (next <= 30) { counts.oneMonth++; bucket.oneMonth++; }
        clinicCounts.set(clinic, bucket);
      }

      counts.totals.patients = screeningsByKey.size;
      counts.totals.clinics = new Set(Array.from(screeningsByKey.values()).map((ss) => clinicOf(bestScreening(ss), batchById))).size;
      counts.byClinic = Array.from(clinicCounts.entries())
        .map(([clinic, c]) => ({ clinic, ...c }))
        .sort((a, b) => a.clinic.localeCompare(b.clinic));

      res.json(counts);
    } catch (error: any) {
      console.error("[patient-database/cooldown-summary] error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/patients/database/:encodedKey", async (req, res) => {
    try {
      const key = decodePatientKey(req.params.encodedKey);
      const [_, dobPart] = key.split("__");
      const _normName = key.split("__")[0];

      const [batches, allTestHistory, allNotes] = await Promise.all([
        storage.getAllScreeningBatches(),
        storage.getAllTestHistory(),
        storage.getAllGeneratedNotes(),
      ]);
      const batchById = new Map(batches.map((b) => [b.id, b] as const));

      const allScreenings: PatientScreening[] = [];
      await Promise.all(
        batches.map(async (b) => {
          const ps = await storage.getPatientScreeningsByBatch(b.id);
          for (const p of ps) allScreenings.push(p);
        }),
      );

      const screenings = allScreenings.filter((s) => patientKey(s.name, s.dob) === key);
      if (screenings.length === 0) {
        return res.status(404).json({ error: "Patient not found" });
      }
      const primary = bestScreening(screenings);
      const clinic = clinicOf(primary, batchById);

      const history = allTestHistory.filter((h) => patientKey(h.patientName, h.dob) === key)
        .sort((a, b) => b.dateOfService.localeCompare(a.dateOfService));
      const cooldowns = computeCooldowns(history, new Date());

      const screeningsOut = screenings
        .map((s) => {
          const b = batchById.get(s.batchId);
          return {
            id: s.id,
            batchId: s.batchId,
            batchName: b?.name ?? "Schedule",
            facility: b?.facility ?? s.facility ?? null,
            scheduleDate: b?.scheduleDate ?? null,
            createdAt: s.createdAt,
            time: s.time,
            qualifyingTests: s.qualifyingTests ?? [],
            appointmentStatus: s.appointmentStatus,
            patientType: s.patientType,
          };
        })
        .sort((a, b) => {
          const ad = a.scheduleDate || (a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : "");
          const bd = b.scheduleDate || (b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : "");
          return bd.localeCompare(ad);
        });

      const notes = allNotes
        .filter((n) => screenings.some((s) => s.id === n.patientId))
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
        .map((n) => ({
          id: n.id,
          batchId: n.batchId,
          patientId: n.patientId,
          service: n.service,
          docKind: n.docKind,
          title: n.title,
          generatedAt: n.generatedAt,
          driveWebViewLink: n.driveWebViewLink,
          facility: n.facility,
          scheduleDate: n.scheduleDate,
        }));

      res.json({
        key,
        encodedKey: req.params.encodedKey,
        identity: {
          name: primary.name,
          dob: primary.dob ?? dobPart ?? null,
          age: primary.age ?? null,
          gender: primary.gender ?? null,
          phoneNumber: primary.phoneNumber ?? null,
          insurance: primary.insurance ?? null,
          clinic,
        },
        clinical: {
          diagnoses: primary.diagnoses ?? null,
          history: primary.history ?? null,
          medications: primary.medications ?? null,
          notes: primary.notes ?? null,
        },
        testHistory: history.map((h) => ({
          id: h.id,
          testName: h.testName,
          dateOfService: h.dateOfService,
          insuranceType: h.insuranceType,
          clinic: h.clinic,
        })),
        cooldowns,
        screenings: screeningsOut,
        generatedNotes: notes,
      });
    } catch (error: any) {
      console.error("[patient-database/profile] error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
