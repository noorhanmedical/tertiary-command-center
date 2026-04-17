import type { IStorage } from "../storage";
import type { ScreeningBatch, PatientScreening } from "@shared/schema";

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
};

type CoverageCardEntry = {
  id: string;
  name: string;
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
    coverageCount: number;
    totalCalls: number;
    totalScheduled: number;
    totalPending: number;
    avgConversion: number;
  };
  coverageCards: CoverageCardEntry[];
};

function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function canonicalDay(v?: string | null): string {
  return s(v).slice(0, 10);
}

function getFacility(batch: ScreeningBatch): string {
  return s(batch.facility) || "Unassigned Facility";
}

function getProvider(batch: ScreeningBatch): string {
  return s(batch.clinicianName) || "No provider";
}

export async function buildOutreachDashboard(
  storage: IStorage,
  today: string,
): Promise<OutreachDashboard> {
  const batches = await storage.getAllScreeningBatches();
  const map = new Map<string, CoverageCardEntry>();

  for (const batch of batches) {
    const batchDay = canonicalDay(batch.scheduleDate);
    if (batchDay && batchDay !== today) continue;

    const patients: PatientScreening[] = await storage.getPatientScreeningsByBatch(batch.id);
    const facility = getFacility(batch);
    const cardId = facility.toLowerCase().replace(/\s+/g, "-");
    const providerName = getProvider(batch);

    if (!map.has(cardId)) {
      map.set(cardId, {
        id: cardId,
        name: facility,
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
      });
    }
  }

  const coverageCards: CoverageCardEntry[] = Array.from(map.values())
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

  const totalPatients = coverageCards.reduce((sum, c) => sum + c.totalPatients, 0);
  const totalScheduled = coverageCards.reduce((sum, c) => sum + c.scheduledCount, 0);

  return {
    today,
    metrics: {
      coverageCount: coverageCards.length,
      totalCalls: coverageCards.reduce((sum, c) => sum + c.touchedCount, 0),
      totalScheduled,
      totalPending: coverageCards.reduce((sum, c) => sum + c.pendingCount, 0),
      avgConversion:
        totalPatients > 0
          ? Math.round((totalScheduled / totalPatients) * 100)
          : 0,
    },
    coverageCards,
  };
}
