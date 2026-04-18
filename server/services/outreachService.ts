import type { IStorage } from "../storage";
import type { PatientScreening, OutreachScheduler } from "@shared/schema";

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
};

type SchedulerCardEntry = {
  id: string;
  name: string;
  facility: string;
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
  };
  schedulerCards: SchedulerCardEntry[];
};

function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function canonicalDay(v?: string | null): string {
  return s(v).slice(0, 10);
}

function resolveSchedulerName(
  facility: string,
  schedulers: OutreachScheduler[],
): string {
  const match = schedulers.find((sc) => sc.facility === facility);
  return match ? match.name : "Unassigned";
}

export async function buildOutreachDashboard(
  storage: IStorage,
  today: string,
): Promise<OutreachDashboard> {
  const [batches, schedulers] = await Promise.all([
    storage.getAllScreeningBatches(),
    storage.getOutreachSchedulers(),
  ]);

  const map = new Map<string, SchedulerCardEntry>();

  for (const batch of batches) {
    const batchDay = canonicalDay(batch.scheduleDate);
    if (batchDay && batchDay !== today) continue;

    const patients: PatientScreening[] = await storage.getPatientScreeningsByBatch(batch.id);
    const facility = s(batch.facility) || "Unassigned Facility";
    const schedulerName = resolveSchedulerName(facility, schedulers);
    const cardId = `${schedulerName.toLowerCase().replace(/\s+/g, "-")}__${facility.toLowerCase().replace(/\s+/g, "-")}`;
    const providerName = s(batch.clinicianName) || "No provider";

    if (!map.has(cardId)) {
      map.set(cardId, {
        id: cardId,
        name: schedulerName,
        facility,
        totalPatients: 0,
        touchedCount: 0,
        scheduledCount: 0,
        pendingCount: 0,
        conversionRate: 0,
        callList: [],
      });
    }

    const entry = map.get(cardId)!;

    for (const patient of patients) {
      const appointmentStatus = s(patient.appointmentStatus) || "pending";
      const n = appointmentStatus.toLowerCase();
      const isTouched = n !== "pending";
      const isScheduled = n.includes("scheduled") || n.includes("booked");

      entry.totalPatients += 1;
      if (isTouched) entry.touchedCount += 1;
      if (isScheduled) entry.scheduledCount += 1;
      if (!isTouched) entry.pendingCount += 1;

      entry.callList.push({
        id: `${batch.id}-${patient.id}`,
        patientId: patient.id,
        patientName: patient.name,
        facility,
        phoneNumber: s(patient.phoneNumber) || "No phone",
        insurance: s(patient.insurance) || "No insurance",
        qualifyingTests: Array.isArray(patient.qualifyingTests)
          ? patient.qualifyingTests
          : [],
        appointmentStatus,
        patientType: s(patient.patientType) || "visit",
        batchId: batch.id,
        scheduleDate: s(batch.scheduleDate),
        time: s(patient.time) || "No time",
        providerName,
        notes: patient.notes ?? null,
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
    },
    schedulerCards,
  };
}
