import type { Express } from "express";
import { storage, type PatientRosterAggregateRow } from "../storage";
import { normalizePatientName, normalizeDob } from "../lib/patientKey";
import { computeCooldowns } from "../services/cooldownCanonical";

const UNASSIGNED = "Unassigned";

// ── Encoding ────────────────────────────────────────────────────────────────
// Roster rows are now keyed by the raw (name, dob) pair the SQL aggregation
// groups on. The encoded key is an opaque base64url token returned to the
// frontend and posted back on the profile endpoint.
const KEY_DELIM = "\u0001";

function encodeRosterKey(name: string, dob: string | null): string {
  return Buffer.from(`${name}${KEY_DELIM}${dob ?? ""}`, "utf-8").toString("base64url");
}

function decodeRosterKey(encoded: string): { name: string; dob: string | null } {
  const raw = Buffer.from(encoded, "base64url").toString("utf-8");
  const idx = raw.indexOf(KEY_DELIM);
  if (idx < 0) return { name: raw, dob: null };
  const dob = raw.slice(idx + 1);
  return { name: raw.slice(0, idx), dob: dob === "" ? null : dob };
}

// ── Response shapes (preserved for the existing UI) ────────────────────────
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

type ClinicGroup = { clinic: string; patients: RosterPatient[] };

// ── Per-response caches keyed by query params ──────────────────────────────
// Each cache entry holds a SQL-aggregated result, NOT the underlying tables.
const RESPONSE_TTL_MS = 30_000;
const rosterResponseCache = new Map<string, { value: any; expires: number }>();
const cooldownSummaryCache = new Map<string, { value: any; expires: number }>();
const importReportCache = new Map<string, { value: any; expires: number }>();

function cacheGet(map: Map<string, { value: any; expires: number }>, key: string) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) { map.delete(key); return null; }
  return hit.value;
}

function cacheSet(map: Map<string, { value: any; expires: number }>, key: string, value: any) {
  map.set(key, { value, expires: Date.now() + RESPONSE_TTL_MS });
  if (map.size > 64) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

export function invalidatePatientDatabase(): void {
  rosterResponseCache.clear();
  cooldownSummaryCache.clear();
  importReportCache.clear();
}

// Back-compat alias for older callers.
export function invalidatePatientDatabaseCache(): void {
  invalidatePatientDatabase();
}

function rosterFromAggregate(row: PatientRosterAggregateRow): RosterPatient {
  const encodedKey = encodeRosterKey(row.name, row.dob);
  return {
    key: encodedKey,
    encodedKey,
    name: row.name,
    dob: row.dob,
    age: row.age,
    gender: row.gender,
    phoneNumber: row.phoneNumber,
    insurance: row.insurance,
    clinic: row.clinic || UNASSIGNED,
    lastVisit: row.lastVisit,
    testCount: row.testCount,
    screeningCount: row.screeningCount,
    generatedNoteCount: row.generatedNoteCount,
    cooldownActiveCount: row.cooldownActiveCount,
    nextCooldownClearsAt: row.nextCooldownClearsAt,
    daysUntilNextClear: row.daysUntilNextClear,
  };
}

export function registerPatientDatabaseRoutes(app: Express) {
  // Roster: SQL GROUP BY (name, dob) with JOINs to test history, generated
  // notes, and screening_batches. Counts/last-visit/cooldown all computed in
  // Postgres so the Node process never iterates over the full source tables.
  app.get("/api/patients/database", async (req, res) => {
    try {
      const search = String(req.query.search || "").trim().toLowerCase();
      const clinicFilter = String(req.query.clinic || "").trim();
      const cooldownWindow = String(req.query.cooldownWindow || "").trim(); // "1d" | "1w" | "1m"

      const pageRaw = parseInt(String(req.query.page ?? ""), 10);
      const pageSizeRaw = parseInt(String(req.query.pageSize ?? ""), 10);
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(500, pageSizeRaw)
        : 100;

      const cacheKey = JSON.stringify({ search, clinicFilter, cooldownWindow, page, pageSize });
      const cached = cacheGet(rosterResponseCache, cacheKey);
      if (cached) return res.json(cached);

      const [aggregate, importReport] = await Promise.all([
        storage.getPatientRosterAggregates({
          search,
          clinic: clinicFilter,
          cooldownWindow,
          page,
          pageSize,
        }),
        storage.getPatientHistoryImportReport(0),
      ]);

      const groupsMap = new Map<string, RosterPatient[]>();
      for (const row of aggregate.rows) {
        const clinic = row.clinic || UNASSIGNED;
        const patient = rosterFromAggregate(row);
        const arr = groupsMap.get(clinic);
        if (arr) arr.push(patient);
        else groupsMap.set(clinic, [patient]);
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

      const totalLoaded = page * pageSize;
      const hasMore = aggregate.total > totalLoaded;

      const payload = {
        groups,
        clinicTotals: aggregate.clinicTotals,
        totals: {
          patients: aggregate.total,
          clinics: aggregate.clinicTotals.length,
        },
        pagination: {
          page,
          pageSize,
          total: aggregate.total,
          hasMore,
        },
        importHealth: {
          unmatchedHistoryCount: importReport.unmatchedCount,
          // SQL aggregation uses exact (name, dob) matching; fuzzy
          // canonicalization has been removed in favour of the SQL JOIN.
          fuzzyMatchedHistoryCount: 0,
        },
      };
      cacheSet(rosterResponseCache, cacheKey, payload);
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cooldown dashboard: counts produced entirely by Postgres aggregation.
  app.get("/api/patients/database/cooldown-summary", async (_req, res) => {
    try {
      const cacheKey = "default";
      const cached = cacheGet(cooldownSummaryCache, cacheKey);
      if (cached) return res.json(cached);

      const dashboard = await storage.getPatientCooldownDashboard();
      const payload = {
        oneDay: dashboard.counts.oneDay,
        oneWeek: dashboard.counts.oneWeek,
        oneMonth: dashboard.counts.oneMonth,
        totals: dashboard.totals,
        byClinic: dashboard.byClinic,
        allClinics: dashboard.allClinics,
      };
      cacheSet(cooldownSummaryCache, cacheKey, payload);
      res.json(payload);
    } catch (error: any) {
      console.error("[patient-database/cooldown-summary] error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import report: counts + small sample of unmatched test-history rows,
  // both produced via SQL.
  app.get("/api/patients/database/import-report", async (_req, res) => {
    try {
      const cacheKey = "default";
      const cached = cacheGet(importReportCache, cacheKey);
      if (cached) return res.json(cached);

      const report = await storage.getPatientHistoryImportReport(200);
      const payload = {
        totals: {
          historyRows: report.totalHistoryRows,
          unmatched: report.unmatchedCount,
          fuzzyMatched: 0,
        },
        byReason: report.unmatchedCount > 0 ? { no_screening: report.unmatchedCount } : {},
        unmatched: report.unmatched.map((u) => ({
          id: u.id,
          patientName: u.patientName,
          dob: u.dob,
          testName: u.testName,
          dateOfService: u.dateOfService,
          clinic: u.clinic,
          reason: "no_screening",
        })),
      };
      cacheSet(importReportCache, cacheKey, payload);
      res.json(payload);
    } catch (error: any) {
      console.error("[patient-database/import-report] error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Per-patient profile: fetches the (name, dob) group's full screening rows,
  // notes, and history with scoped queries — never the whole tables.
  app.get("/api/patients/database/:encodedKey", async (req, res) => {
    try {
      let name: string;
      let dob: string | null;
      try {
        ({ name, dob } = decodeRosterKey(req.params.encodedKey));
        if (!name) throw new Error("empty");
      } catch {
        return res.status(400).json({ error: "Invalid patient key" });
      }

      const [fullScreenings, history] = await Promise.all([
        storage.getPatientGroupScreenings(name, dob),
        storage.getPatientGroupTestHistory(name, dob),
      ]);

      if (fullScreenings.length === 0) {
        return res.status(404).json({ error: "Patient not found" });
      }

      // Pick most-recent screening as identity record.
      let primary = fullScreenings[0];
      let primaryT = primary.createdAt ? new Date(primary.createdAt).getTime() : 0;
      for (let i = 1; i < fullScreenings.length; i++) {
        const t = fullScreenings[i].createdAt ? new Date(fullScreenings[i].createdAt).getTime() : 0;
        if (t > primaryT) { primary = fullScreenings[i]; primaryT = t; }
      }

      const batchIds = Array.from(new Set(fullScreenings.map((s) => s.batchId)));
      const screeningIds = fullScreenings.map((s) => s.id);
      const [batches, notes] = await Promise.all([
        Promise.all(batchIds.map((id) => storage.getScreeningBatch(id))),
        storage.getGeneratedNotesByPatientIds(screeningIds),
      ]);
      const batchById = new Map(batches.filter(Boolean).map((b) => [b!.id, b!] as const));
      const clinic = primary.facility || batchById.get(primary.batchId)?.facility || UNASSIGNED;

      // Reuse the canonical cooldown helper so the response shape matches
      // what the frontend already consumes (lastDate, cooldownMonths,
      // historyId, clearsAt, etc.).
      const cooldowns = computeCooldowns(
        history.map((h) => ({
          id: h.id,
          testName: h.testName,
          dateOfService: h.dateOfService,
          insuranceType: h.insuranceType,
          clinic: h.clinic ?? null,
        })),
        new Date(),
      );

      const screeningsOut = fullScreenings
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

      const notesOut = notes
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
        key: req.params.encodedKey,
        encodedKey: req.params.encodedKey,
        identity: {
          name: primary.name,
          dob: primary.dob ?? dob ?? null,
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
        generatedNotes: notesOut,
      });
    } catch (error: any) {
      console.error("[patient-database/profile] error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}

// Re-export helpers for tests/imports.
export { normalizePatientName, normalizeDob };
