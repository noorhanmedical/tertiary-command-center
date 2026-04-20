import type { IStorage } from "../storage";
import {
  CLINIC_SPREADSHEET_CONNECTIONS,
  SHARED_CALENDAR_SPREADSHEET_ID,
  resolveSchedulerForClinic,
} from "../../shared/platformSettings";

type ScheduleBatch = {
  id: number;
  facility: string | null;
  scheduleDate: string | null;
  clinicianName: string | null;
};

type SchedulePatient = {
  id: number;
  name: string;
  time?: string | null;
  patientType?: string | null;
  qualifyingTests?: string[] | null;
  appointmentStatus?: string | null;
};

export function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function canonicalDay(v?: string | null): string {
  return s(v).slice(0, 10);
}

export function startOfWeekIso(baseIso: string): string {
  const [year, month, day] = baseIso.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthGridDates(baseIso: string): string[] {
  const [year, month] = baseIso.split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const weekday = first.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  first.setDate(first.getDate() + offset);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

export function ancillaryCounts(tests: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const test of tests) {
    const key = s(test);
    if (!key) continue;
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

export async function buildScheduleDashboard(storage: IStorage, selectedWeekStart?: string) {
  const today = canonicalDay(new Date().toISOString());
  const weekStart = selectedWeekStart || startOfWeekIso(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  const monthDates = monthGridDates(weekStart);

  const batches = (await storage.getAllScreeningBatches()) as ScheduleBatch[];

  const todaysAncillaryCounts: Record<string, number> = {};
  let todaysAncillaryTotal = 0;
  const clinicMap = new Map<string, any>();

  for (const connection of CLINIC_SPREADSHEET_CONNECTIONS) {
    clinicMap.set(connection.clinicLabel, {
      clinicKey: connection.clinicKey,
      clinicLabel: connection.clinicLabel,
      spreadsheetId: connection.spreadsheetId,
      patientTabName: connection.patientTabName,
      calendarTabName: connection.calendarTabName,
      scheduler: resolveSchedulerForClinic(connection.clinicLabel),
      weekDays: weekDays.map((iso) => ({
        isoDate: iso,
        patientCount: 0,
        ancillaryCount: 0,
        ancillaryBreakdown: {},
        providerNames: [],
      })),
      monthCells: monthDates.map((iso) => ({
        isoDate: iso,
        patientCount: 0,
        ancillaryCount: 0,
        patients: [] as { id: number; name: string; time: string | null; ancillaries: string[] }[],
      })),
    });
  }

  for (const batch of batches) {
    const facility = s(batch.facility) || "Unassigned Facility";
    const batchDay = canonicalDay(batch.scheduleDate);
    if (!clinicMap.has(facility)) {
      clinicMap.set(facility, {
        clinicKey: facility.toLowerCase().replace(/\s+/g, "-"),
        clinicLabel: facility,
        spreadsheetId: "",
        patientTabName: "Patients",
        calendarTabName: "Calendar",
        scheduler: resolveSchedulerForClinic(facility),
        weekDays: weekDays.map((iso) => ({
          isoDate: iso,
          patientCount: 0,
          ancillaryCount: 0,
          ancillaryBreakdown: {},
          providerNames: [],
        })),
        monthCells: monthDates.map((iso) => ({
          isoDate: iso,
          patientCount: 0,
          ancillaryCount: 0,
          patients: [] as { id: number; name: string; time: string | null; ancillaries: string[] }[],
        })),
      });
    }

    const clinicEntry = clinicMap.get(facility);
    const patients = (await storage.getPatientScreeningsByBatch(batch.id)) as SchedulePatient[];

    for (const patient of patients) {
      const tests = Array.isArray(patient.qualifyingTests) ? patient.qualifyingTests.filter(Boolean) : [];
      const count = tests.length;

      if (batchDay === today) {
        todaysAncillaryTotal += count;
        const counts = ancillaryCounts(tests);
        for (const [testName, num] of Object.entries(counts)) {
          todaysAncillaryCounts[testName] = (todaysAncillaryCounts[testName] || 0) + num;
        }
      }

      const weekCell = clinicEntry.weekDays.find((d: any) => d.isoDate === batchDay);
      if (weekCell) {
        weekCell.patientCount += 1;
        weekCell.ancillaryCount += count;
        const counts = ancillaryCounts(tests);
        for (const [testName, num] of Object.entries(counts)) {
          weekCell.ancillaryBreakdown[testName] = (weekCell.ancillaryBreakdown[testName] || 0) + num;
        }
        const providerName = s(batch.clinicianName);
        if (providerName && !weekCell.providerNames.includes(providerName)) {
          weekCell.providerNames.push(providerName);
        }
      }

      const monthCell = clinicEntry.monthCells.find((d: any) => d.isoDate === batchDay);
      if (monthCell) {
        monthCell.patientCount += 1;
        monthCell.ancillaryCount += count;
        monthCell.patients.push({
          id: patient.id,
          name: s(patient.name),
          time: patient.time ?? null,
          ancillaries: tests.map((t) => s(t)).filter(Boolean),
        });
      }
    }
  }

  const clinicTabs = Array.from(clinicMap.values()).sort((a, b) =>
    a.clinicLabel.localeCompare(b.clinicLabel),
  );

  return {
    today,
    weekStart,
    previousWeekStart: addDaysIso(weekStart, -7),
    nextWeekStart: addDaysIso(weekStart, 7),
    sharedCalendarSpreadsheetId: SHARED_CALENDAR_SPREADSHEET_ID,
    dailySnapshot: {
      totalAncillariesScheduled: todaysAncillaryTotal,
      ancillaryBreakdown: todaysAncillaryCounts,
      activeClinicsToday: clinicTabs.filter((tab) =>
        tab.weekDays.some((d: any) => d.isoDate === today && d.patientCount > 0),
      ).length,
      activeSchedulersToday: clinicTabs.filter((tab) =>
        tab.scheduler && tab.weekDays.some((d: any) => d.isoDate === today && d.patientCount > 0),
      ).length,
    },
    clinicTabs,
  };
}
