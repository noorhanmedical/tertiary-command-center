import type { PatientTestHistory } from "@shared/schema";
import { patientKey } from "../lib/patientKey";

export function cooldownMonthsFor(insuranceType: string | null | undefined): number {
  return (insuranceType || "").toLowerCase() === "medicare" ? 12 : 6;
}

export type TestCooldownEntry = {
  testName: string;
  lastDate: string;
  insuranceType: string;
  cooldownMonths: number;
  clearsAt: string; // YYYY-MM-DD
  clearsAtMs: number;
  daysUntilClear: number; // negative = already cleared
  cleared: boolean;
  clinic: string | null;
  historyId: number;
};

function parseDate(d: string): Date | null {
  if (!d) return null;
  const dt = new Date(d.includes("T") ? d : `${d}T00:00:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Compute canonical cooldown breakdown for one patient's test history records.
 * For each test name, only the most recent service date is returned (it dominates older entries).
 */
export function computeCooldowns(
  records: PatientTestHistory[],
  now: Date = new Date(),
): TestCooldownEntry[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const byTest = new Map<string, PatientTestHistory>();
  for (const r of records) {
    const key = r.testName.trim().toLowerCase();
    const cur = byTest.get(key);
    if (!cur || r.dateOfService > cur.dateOfService) byTest.set(key, r);
  }

  const out: TestCooldownEntry[] = [];
  for (const r of Array.from(byTest.values())) {
    const lastDate = parseDate(r.dateOfService);
    if (!lastDate) continue;
    const months = cooldownMonthsFor(r.insuranceType);
    const clears = new Date(lastDate);
    clears.setMonth(clears.getMonth() + months);
    const days = Math.round((clears.getTime() - today.getTime()) / 86400000);
    out.push({
      testName: r.testName,
      lastDate: r.dateOfService,
      insuranceType: (r.insuranceType || "ppo").toLowerCase(),
      cooldownMonths: months,
      clearsAt: toISODate(clears),
      clearsAtMs: clears.getTime(),
      daysUntilClear: days,
      cleared: days <= 0,
      clinic: r.clinic ?? null,
      historyId: r.id,
    });
  }
  out.sort((a, b) => a.clearsAtMs - b.clearsAtMs);
  return out;
}

/**
 * Group test history records by canonical patient key (normalized name + DOB).
 */
export function groupHistoryByPatient(records: PatientTestHistory[]): Map<string, PatientTestHistory[]> {
  const map = new Map<string, PatientTestHistory[]>();
  for (const r of records) {
    const k = patientKey(r.patientName, r.dob);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}
