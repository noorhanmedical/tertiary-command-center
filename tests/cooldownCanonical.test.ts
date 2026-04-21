import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PatientScreening, PatientTestHistory } from "@shared/schema";
import { reconcileHistoryToScreenings } from "../server/services/cooldownCanonical";
import { patientKey } from "../server/lib/patientKey";

let nextHistoryId = 1;
function makeHistory(overrides: Partial<PatientTestHistory>): PatientTestHistory {
  return {
    id: nextHistoryId++,
    patientName: "Jane Doe",
    dob: "1980-01-15",
    testName: "Colonoscopy",
    dateOfService: "2024-06-01",
    insuranceType: "ppo",
    clinic: "NWPG",
    notes: null,
    createdAt: new Date(),
    ...overrides,
  } as PatientTestHistory;
}

let nextScreeningId = 1;
function makeScreening(overrides: Partial<PatientScreening>): PatientScreening {
  return {
    id: nextScreeningId++,
    batchId: 1,
    patientName: "Jane Doe",
    dob: "1980-01-15",
    clinic: "NWPG",
    ...overrides,
  } as unknown as PatientScreening;
}

/**
 * Build helpers used by reconcileHistoryToScreenings:
 *   - screeningsByKey: Map<patientKey, screening[]>
 *   - clinicForScreeningKey: lookup function returning the clinic for a key
 */
function buildIndex(screenings: PatientScreening[]) {
  const byKey = new Map<string, PatientScreening[]>();
  const clinicByKey = new Map<string, string>();
  for (const s of screenings) {
    const key = patientKey(s.patientName, s.dob);
    const arr = byKey.get(key);
    if (arr) arr.push(s);
    else byKey.set(key, [s]);
    if (!clinicByKey.has(key)) clinicByKey.set(key, s.clinic ?? "");
  }
  return {
    byKey,
    clinicFor: (k: string) => clinicByKey.get(k) ?? "",
  };
}

describe("reconcileHistoryToScreenings", () => {
  it("attaches a history row to the exact name+DOB screening key", () => {
    const screenings = [
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "NWPG" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    const expectedKey = patientKey("Jane Doe", "1980-01-15");
    assert.equal(res.unmatched.length, 0);
    assert.equal(res.fuzzyMatched, 0);
    assert.equal(res.historyByKey.get(expectedKey)?.length, 1);
  });

  it("matches a name variant + same DOB exactly via canonical key", () => {
    const screenings = [
      makeScreening({ patientName: "William Smith", dob: "1970-03-04", clinic: "NWPG" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Bill Smith", dob: "1970-03-04", clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    const expectedKey = patientKey("William Smith", "1970-03-04");
    assert.equal(res.unmatched.length, 0);
    assert.equal(res.fuzzyMatched, 0);
    assert.equal(res.historyByKey.get(expectedKey)?.length, 1);
  });

  it("attaches a DOB-missing history row when one screening matches in the same clinic", () => {
    const screenings = [
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "NWPG" }),
      // Different canonical name in same clinic — should not interfere.
      makeScreening({ patientName: "John Roe", dob: "1975-05-05", clinic: "NWPG" }),
      // Same canonical name but different clinic — shouldn't matter when a same-clinic match exists.
      makeScreening({ patientName: "Jane Doe", dob: "1990-09-09", clinic: "Other" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Jane Doe", dob: null, clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    const expectedKey = patientKey("Jane Doe", "1980-01-15");
    assert.equal(res.unmatched.length, 0);
    assert.equal(res.fuzzyMatched, 1);
    assert.equal(res.historyByKey.get(expectedKey)?.length, 1);
  });

  it("flags ambiguous when DOB is missing and multiple screenings share the canonical name in the same clinic", () => {
    const screenings = [
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "NWPG" }),
      makeScreening({ patientName: "Jane Doe", dob: "1992-07-22", clinic: "NWPG" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ id: 999, patientName: "Jane Doe", dob: null, clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    assert.equal(res.fuzzyMatched, 0);
    assert.equal(res.unmatched.length, 1);
    assert.equal(res.unmatched[0].reason, "no_dob_ambiguous");
    assert.equal(res.unmatched[0].candidateCount, 2);
    assert.equal(res.unmatched[0].id, 999);
  });

  it("attaches a DOB-missing history row across clinics when exactly one screening matches anywhere", () => {
    const screenings = [
      // Only screening for this canonical name lives in a different clinic.
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "Other" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Jane Doe", dob: null, clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    const expectedKey = patientKey("Jane Doe", "1980-01-15");
    assert.equal(res.unmatched.length, 0);
    assert.equal(res.fuzzyMatched, 1);
    assert.equal(res.historyByKey.get(expectedKey)?.length, 1);
  });

  it("flags cross-clinic ambiguity when DOB is missing and multiple screenings exist in other clinics", () => {
    const screenings = [
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "Other A" }),
      makeScreening({ patientName: "Jane Doe", dob: "1992-07-22", clinic: "Other B" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Jane Doe", dob: null, clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    assert.equal(res.fuzzyMatched, 0);
    assert.equal(res.unmatched.length, 1);
    assert.equal(res.unmatched[0].reason, "no_dob_cross_clinic");
    assert.equal(res.unmatched[0].candidateCount, 2);
  });

  it("flags dob_mismatch when canonical name matches but DOB differs from every known screening", () => {
    const screenings = [
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "NWPG" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Jane Doe", dob: "1999-12-31", clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    assert.equal(res.fuzzyMatched, 0);
    assert.equal(res.unmatched.length, 1);
    assert.equal(res.unmatched[0].reason, "dob_mismatch");
    assert.equal(res.unmatched[0].candidateCount, 1);
    // The row is still preserved in historyByKey under its own (mismatched) key.
    const ownKey = patientKey("Jane Doe", "1999-12-31");
    assert.equal(res.historyByKey.get(ownKey)?.length, 1);
  });

  it("flags no_screening when no screening shares the canonical name", () => {
    const screenings = [
      makeScreening({ patientName: "Jane Doe", dob: "1980-01-15", clinic: "NWPG" }),
    ];
    const { byKey, clinicFor } = buildIndex(screenings);
    const history = [
      makeHistory({ patientName: "Unknown Person", dob: "1980-01-15", clinic: "NWPG" }),
    ];

    const res = reconcileHistoryToScreenings(history, byKey, clinicFor);

    assert.equal(res.unmatched.length, 1);
    assert.equal(res.unmatched[0].reason, "no_screening");
  });
});
