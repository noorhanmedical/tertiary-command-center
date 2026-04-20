import type { IStorage } from "../storage";
import type { PatientScreening, OutreachScheduler, PatientTestHistory } from "@shared/schema";
import { patientKey } from "../lib/patientKey";

type PriorTestEntry = {
  testName: string;
  dateOfService: string;
  clinic: string | null;
  notes: string | null;
};

type ReasoningEntry = {
  testName: string;
  text: string;
  pearls?: string[];
  qualifyingFactors?: string[];
};

type OutreachCallItem = {
  id: string;
  patientId: number;
  patientName: string;
  facility: string;
  phoneNumber: string;
  insurance: string;
  qualifyingTests: string[];
  appointmentStatus: string;
  patientType: string;
  batchId: number;
  scheduleDate: string;
  time: string;
  providerName: string;
  notes: string | null;
  // Enriched fields
  dob: string | null;
  age: number | null;
  gender: string | null;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
  previousTests: string | null;
  previousTestsDate: string | null;
  noPreviousTests: boolean;
  reasoning: ReasoningEntry[];
  priorTestHistory: PriorTestEntry[];
};

type SchedulerCardEntry = {
  id: string;
  name: string;
  facility: string;
  capacityPercent: number;
  totalPatients: number;
  touchedCount: number;
  scheduledCount: number;
  pendingCount: number;
  conversionRate: number;
  callList: OutreachCallItem[];
};

export type OutreachDashboard = {
  today: string;
  metrics: {
    schedulerCount: number;
    totalCalls: number;
    totalScheduled: number;
    totalPending: number;
    avgConversion: number;
    totalBooked: number;
  };
  schedulerCards: SchedulerCardEntry[];
  uncoveredFacilities: string[];
};

function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function canonicalDay(v?: string | null): string {
  return s(v).slice(0, 10);
}

function cardIdFor(name: string, facility: string): string {
  return `${name.toLowerCase().replace(/\s+/g, "-")}__${facility.toLowerCase().replace(/\s+/g, "-")}`;
}

/**
 * Deterministic 32-bit hash (FNV-1a) used so the same patient is always assigned
 * to the same scheduler within a clinic for the day, regardless of fetch order.
 */
function hashPatient(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Capacity-weighted assignment: pick a scheduler from `pool` for the patient using
 * a stable hash, weighted by each scheduler's capacityPercent. Single-scheduler
 * pools always return that scheduler. Pools with all-zero capacity fall back to
 * uniform distribution.
 */
function pickSchedulerForPatient(
  patientId: number,
  pool: OutreachScheduler[],
): OutreachScheduler {
  if (pool.length === 1) return pool[0];
  const totalWeight = pool.reduce((sum, sc) => sum + Math.max(0, sc.capacityPercent || 0), 0);
  if (totalWeight <= 0) {
    return pool[hashPatient(`p:${patientId}`) % pool.length];
  }
  const bucket = hashPatient(`p:${patientId}`) % totalWeight;
  let acc = 0;
  for (const sc of pool) {
    acc += Math.max(0, sc.capacityPercent || 0);
    if (bucket < acc) return sc;
  }
  return pool[pool.length - 1];
}

function normalizeReasoning(raw: unknown, qualifyingTests: string[]): ReasoningEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const out: ReasoningEntry[] = [];
  // Preserve qualifying-test order when possible; fall back to whatever keys exist.
  const orderedKeys = qualifyingTests.length > 0
    ? Array.from(new Set([...qualifyingTests, ...Object.keys(obj)]))
    : Object.keys(obj);
  for (const key of orderedKeys) {
    const v = obj[key];
    if (v == null) continue;
    if (typeof v === "string") {
      const text = v.trim();
      if (text) out.push({ testName: key, text });
      continue;
    }
    if (typeof v === "object") {
      const r = v as Record<string, unknown>;
      const text = s(r.clinician_understanding) || s(r.patient_talking_points);
      const pearls = Array.isArray(r.pearls) ? (r.pearls as unknown[]).map(String).filter(Boolean) : undefined;
      const qf = Array.isArray(r.qualifying_factors) ? (r.qualifying_factors as unknown[]).map(String).filter(Boolean) : undefined;
      if (text || (pearls && pearls.length) || (qf && qf.length)) {
        out.push({ testName: key, text, pearls, qualifyingFactors: qf });
      }
    }
  }
  return out;
}

// Visit window for the dashboard call list. Aligned with the call-list
// engine's CALL_LIST_VISIT_WINDOW_DAYS so patients whose visits are within
// the next N days surface to the assigned scheduler. Outreach-type patients
// (no scheduleDate gating) always surface.
const DASHBOARD_VISIT_WINDOW_DAYS = Number(process.env.CALL_LIST_VISIT_WINDOW_DAYS ?? 30);

function withinDashboardWindow(scheduleDate: string, today: string): boolean {
  if (!scheduleDate) return true;
  if (scheduleDate < today) return false;
  const start = new Date(`${today}T00:00:00Z`).getTime();
  const dest = new Date(`${scheduleDate}T00:00:00Z`).getTime();
  if (isNaN(start) || isNaN(dest)) return false;
  return Math.round((dest - start) / 86_400_000) <= DASHBOARD_VISIT_WINDOW_DAYS;
}

export async function buildOutreachDashboard(
  storage: IStorage,
  today: string,
): Promise<OutreachDashboard> {
  const [batches, schedulers, todayAppointments, allHistory, activeAssignments] = await Promise.all([
    storage.getAllScreeningBatches(),
    storage.getOutreachSchedulers(),
    storage.getAppointments({ date: today, status: "scheduled" }),
    storage.getAllTestHistory(),
    storage.listActiveSchedulerAssignments({ asOfDate: today }),
  ]);

  // Build patient->scheduler ownership map from active engine assignments.
  // When an active row exists, it is the source of truth for ownership and
  // overrides the hash-based fallback below.
  const assignedSchedulerByPatient = new Map<number, number>();
  for (const a of activeAssignments) assignedSchedulerByPatient.set(a.patientScreeningId, a.schedulerId);
  const schedulerById = new Map(schedulers.map((s) => [s.id, s]));

  // Group history by canonical patient key for fast lookup.
  const historyByKey = new Map<string, PatientTestHistory[]>();
  for (const h of allHistory) {
    const k = patientKey(h.patientName, h.dob);
    const arr = historyByKey.get(k);
    if (arr) arr.push(h);
    else historyByKey.set(k, [h]);
  }

  // Build pool of schedulers per facility.
  const schedulersByFacility = new Map<string, OutreachScheduler[]>();
  for (const sc of schedulers) {
    const arr = schedulersByFacility.get(sc.facility);
    if (arr) arr.push(sc);
    else schedulersByFacility.set(sc.facility, [sc]);
  }

  const map = new Map<string, SchedulerCardEntry>();
  const uncoveredFacilitySet = new Set<string>();

  // Pre-seed all known schedulers so empty cards still appear.
  for (const sc of schedulers) {
    const id = cardIdFor(sc.name, sc.facility);
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: sc.name,
        facility: sc.facility,
        capacityPercent: sc.capacityPercent ?? 100,
        totalPatients: 0,
        touchedCount: 0,
        scheduledCount: 0,
        pendingCount: 0,
        conversionRate: 0,
        callList: [],
      });
    }
  }

  for (const batch of batches) {
    const batchDay = canonicalDay(batch.scheduleDate);
    const inWindow = withinDashboardWindow(batchDay, today);

    const patients: PatientScreening[] = await storage.getPatientScreeningsByBatch(batch.id);
    const facility = s(batch.facility) || "Unassigned Facility";
    const providerName = s(batch.clinicianName) || "No provider";
    const pool = schedulersByFacility.get(facility) ?? [];

    if (pool.length === 0 && patients.length > 0) {
      uncoveredFacilitySet.add(facility);
    }

    for (const patient of patients) {
      // HARD GATE: Drafts must never leak into a scheduler's call list.
      // Only patients that have been committed (Ready or later) are
      // visible here. Legacy data was backfilled by migration 0013 so
      // existing patients keep their place.
      if (patient.commitStatus === "Draft") continue;

      // Engine assignment is authoritative; otherwise gate by visit window
      // (outreach-type patients bypass the window entirely).
      const isOutreach = (s(patient.patientType) || "visit").toLowerCase() === "outreach";
      const hasAssignment = assignedSchedulerByPatient.has(patient.id);
      if (!hasAssignment && !isOutreach && !inWindow) continue;

      let owner: { name: string; facility: string; capacityPercent: number };
      const assignedSchedId = assignedSchedulerByPatient.get(patient.id);
      const assignedSched = assignedSchedId ? schedulerById.get(assignedSchedId) : undefined;
      if (assignedSched) {
        owner = {
          name: assignedSched.name,
          facility: assignedSched.facility,
          capacityPercent: assignedSched.capacityPercent ?? 100,
        };
      } else if (pool.length === 0) {
        owner = { name: "Unassigned", facility, capacityPercent: 0 };
      } else {
        const picked = pickSchedulerForPatient(patient.id, pool);
        owner = { name: picked.name, facility: picked.facility, capacityPercent: picked.capacityPercent ?? 100 };
      }

      const cardId = cardIdFor(owner.name, owner.facility);
      let entry = map.get(cardId);
      if (!entry) {
        entry = {
          id: cardId,
          name: owner.name,
          facility: owner.facility,
          capacityPercent: owner.capacityPercent,
          totalPatients: 0,
          touchedCount: 0,
          scheduledCount: 0,
          pendingCount: 0,
          conversionRate: 0,
          callList: [],
        };
        map.set(cardId, entry);
      }

      const appointmentStatus = s(patient.appointmentStatus) || "pending";
      const n = appointmentStatus.toLowerCase();
      const isTouched = n !== "pending";
      const isScheduled = n.includes("scheduled") || n.includes("booked");

      entry.totalPatients += 1;
      if (isTouched) entry.touchedCount += 1;
      if (isScheduled) entry.scheduledCount += 1;
      if (!isTouched) entry.pendingCount += 1;

      const qualifyingTests = Array.isArray(patient.qualifyingTests) ? patient.qualifyingTests : [];
      const reasoning = normalizeReasoning(patient.reasoning, qualifyingTests);

      // Prior test history matched by canonical name + DOB.
      const pkey = patientKey(patient.name, patient.dob);
      const matched = historyByKey.get(pkey) ?? [];
      const priorTestHistory: PriorTestEntry[] = matched
        .slice()
        .sort((a, b) => (b.dateOfService || "").localeCompare(a.dateOfService || ""))
        .map((h) => ({
          testName: h.testName,
          dateOfService: h.dateOfService,
          clinic: h.clinic ?? null,
          notes: h.notes ?? null,
        }));

      entry.callList.push({
        id: `${batch.id}-${patient.id}`,
        patientId: patient.id,
        patientName: patient.name,
        facility,
        phoneNumber: s(patient.phoneNumber) || "No phone",
        insurance: s(patient.insurance) || "No insurance",
        qualifyingTests,
        appointmentStatus,
        patientType: s(patient.patientType) || "visit",
        batchId: batch.id,
        scheduleDate: s(batch.scheduleDate),
        time: s(patient.time) || "No time",
        providerName,
        notes: patient.notes ?? null,
        dob: patient.dob ?? null,
        age: patient.age ?? null,
        gender: patient.gender ?? null,
        diagnoses: patient.diagnoses ?? null,
        history: patient.history ?? null,
        medications: patient.medications ?? null,
        previousTests: patient.previousTests ?? null,
        previousTestsDate: patient.previousTestsDate ?? null,
        noPreviousTests: !!patient.noPreviousTests,
        reasoning,
        priorTestHistory,
      });
    }
  }

  const schedulerCards: SchedulerCardEntry[] = Array.from(map.values())
    .map((entry) => ({
      ...entry,
      callList: [...entry.callList].sort(
        (a, b) =>
          a.time.localeCompare(b.time) ||
          a.patientName.localeCompare(b.patientName),
      ),
      conversionRate:
        entry.totalPatients > 0
          ? Math.round((entry.scheduledCount / entry.totalPatients) * 100)
          : 0,
    }))
    .sort(
      (a, b) =>
        b.totalPatients - a.totalPatients || a.name.localeCompare(b.name),
    );

  const totalPatients = schedulerCards.reduce((sum, c) => sum + c.totalPatients, 0);
  const totalScheduled = schedulerCards.reduce((sum, c) => sum + c.scheduledCount, 0);

  const allPatientNames = new Set(
    schedulerCards.flatMap((c) =>
      c.callList.map((item) => item.patientName.trim().toLowerCase()),
    ),
  );
  const bookedPatientNames = new Set(
    todayAppointments
      .map((a) => a.patientName.trim().toLowerCase())
      .filter((name) => allPatientNames.has(name)),
  );
  const totalBooked = bookedPatientNames.size;

  return {
    today,
    metrics: {
      schedulerCount: schedulerCards.length,
      totalCalls: schedulerCards.reduce((sum, c) => sum + c.touchedCount, 0),
      totalScheduled,
      totalPending: schedulerCards.reduce((sum, c) => sum + c.pendingCount, 0),
      avgConversion:
        totalPatients > 0
          ? Math.round((totalScheduled / totalPatients) * 100)
          : 0,
      totalBooked,
    },
    schedulerCards,
    uncoveredFacilities: Array.from(uncoveredFacilitySet).sort(),
  };
}
