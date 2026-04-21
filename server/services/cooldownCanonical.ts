import type { PatientScreening, PatientTestHistory } from "@shared/schema";
import { canonicalNameKey, normalizeDob, patientKey } from "../lib/patientKey";

// Structural shapes used by the helpers below. Accepting these (rather than
// the full row types) lets callers pass lean projections from
// patient-database aggregation queries.
type CooldownHistoryRow = {
  id: number;
  testName: string;
  dateOfService: string;
  insuranceType: string;
  clinic: string | null;
};

type ReconcileHistoryRow = {
  id: number;
  patientName: string;
  dob: string | null;
  testName: string;
  dateOfService: string;
  clinic: string | null;
};

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
  records: CooldownHistoryRow[],
  now: Date = new Date(),
): TestCooldownEntry[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const byTest = new Map<string, CooldownHistoryRow>();
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

export type UnmatchedHistoryReason =
  | "no_screening"        // No screening exists with this canonical name anywhere
  | "no_dob_ambiguous"    // History row lacks DOB and >1 screening shares the canonical name in this clinic
  | "no_dob_cross_clinic" // History row lacks DOB; only matches found in other clinic(s) and not unique
  | "dob_mismatch";       // Canonical name matches a known screening but DOB differs

export type UnmatchedHistoryRow = {
  id: number;
  patientName: string;
  dob: string | null;
  testName: string;
  dateOfService: string;
  clinic: string | null;
  reason: UnmatchedHistoryReason;
  candidateCount: number;
};

export type ReconciliationResult = {
  historyByKey: Map<string, PatientTestHistory[]>;
  unmatched: UnmatchedHistoryRow[];
  /** History rows reattached via name-only match (DOB missing); useful for surface review. */
  fuzzyMatched: number;
};

/**
 * Attach test history rows to known screening keys, even when the history row
 * lacks a DOB or uses a name variant. Strategy:
 *   1. If canonical-name + DOB is already a known screening key, use it (exact).
 *   2. If history row lacks DOB, look up screenings sharing the canonical name:
 *        a) restricted to the same clinic — if exactly one, attach to it.
 *        b) otherwise across all clinics — if exactly one, attach to it.
 *   3. Otherwise, the history row is left under its own key and reported as
 *      unmatched with a reason.
 */
export function reconcileHistoryToScreenings<H extends ReconcileHistoryRow>(
  history: H[],
  screeningsByKey: Map<string, unknown>,
  clinicForScreeningKey: (key: string) => string,
): {
  historyByKey: Map<string, H[]>;
  unmatched: UnmatchedHistoryRow[];
  fuzzyMatched: number;
} {
  const normalizeClinic = (c: string | null | undefined): string =>
    (c ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  // Index screening keys by canonical name -> { normalized clinic -> [keys] }
  const byCanonical = new Map<string, Map<string, string[]>>();
  for (const key of Array.from(screeningsByKey.keys())) {
    const { name } = (function () {
      const idx = key.indexOf("__");
      return idx < 0 ? { name: key } : { name: key.slice(0, idx) };
    })();
    if (!name) continue;
    const clinic = normalizeClinic(clinicForScreeningKey(key));
    let clinicMap = byCanonical.get(name);
    if (!clinicMap) {
      clinicMap = new Map();
      byCanonical.set(name, clinicMap);
    }
    const arr = clinicMap.get(clinic);
    if (arr) arr.push(key);
    else clinicMap.set(clinic, [key]);
  }

  const out = new Map<string, H[]>();
  const unmatched: UnmatchedHistoryRow[] = [];
  let fuzzyMatched = 0;

  for (const row of history) {
    const canonical = canonicalNameKey(row.patientName);
    const dob = normalizeDob(row.dob);
    const exactKey = `${canonical}__${dob}`;

    let chosenKey: string | null = null;
    let reason: UnmatchedHistoryReason | null = null;
    let candidateCount = 0;

    if (screeningsByKey.has(exactKey)) {
      chosenKey = exactKey;
    } else {
      const clinicMap = byCanonical.get(canonical);
      if (!clinicMap) {
        reason = "no_screening";
      } else if (!dob) {
        // Try same-clinic single match (clinic strings are normalized for comparison)
        const sameClinic = clinicMap.get(normalizeClinic(row.clinic)) ?? [];
        const allKeys: string[] = [];
        for (const list of Array.from(clinicMap.values())) for (const k of list) allKeys.push(k);
        if (sameClinic.length === 1) {
          chosenKey = sameClinic[0];
          fuzzyMatched++;
        } else if (sameClinic.length > 1) {
          reason = "no_dob_ambiguous";
          candidateCount = sameClinic.length;
        } else if (allKeys.length === 1) {
          chosenKey = allKeys[0];
          fuzzyMatched++;
        } else {
          reason = "no_dob_cross_clinic";
          candidateCount = allKeys.length;
        }
      } else {
        // Has dob but no exact key match while canonical name does exist somewhere
        reason = "dob_mismatch";
        let count = 0;
        for (const list of Array.from(clinicMap.values())) count += list.length;
        candidateCount = count;
      }
    }

    if (chosenKey) {
      const arr = out.get(chosenKey);
      if (arr) arr.push(row);
      else out.set(chosenKey, [row]);
    } else {
      // Still group under its own key so the data is preserved for later passes,
      // but record it for the import report.
      const arr = out.get(exactKey);
      if (arr) arr.push(row);
      else out.set(exactKey, [row]);
      unmatched.push({
        id: row.id,
        patientName: row.patientName,
        dob: row.dob ?? null,
        testName: row.testName,
        dateOfService: row.dateOfService,
        clinic: row.clinic ?? null,
        reason: reason ?? "no_screening",
        candidateCount,
      });
    }
  }

  return { historyByKey: out, unmatched, fuzzyMatched };
}
