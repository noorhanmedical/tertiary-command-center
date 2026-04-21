import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PatientTestHistory } from "@shared/schema";
import {
  computeCooldowns,
  cooldownMonthsFor,
  groupHistoryByPatient,
} from "../server/services/cooldownCanonical";
import { patientKey } from "../server/lib/patientKey";

type CooldownInput = {
  id: number;
  testName: string;
  dateOfService: string;
  insuranceType: string;
  clinic: string | null;
};

let nextId = 1;
function makeRow(overrides: Partial<CooldownInput>): CooldownInput {
  return {
    id: nextId++,
    testName: "Colonoscopy",
    dateOfService: "2024-06-01",
    insuranceType: "ppo",
    clinic: "NWPG",
    ...overrides,
  };
}

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

describe("cooldownMonthsFor", () => {
  it("returns 12 months for Medicare (case-insensitive)", () => {
    assert.equal(cooldownMonthsFor("medicare"), 12);
    assert.equal(cooldownMonthsFor("Medicare"), 12);
    assert.equal(cooldownMonthsFor("MEDICARE"), 12);
  });

  it("returns 6 months for PPO and other insurance types", () => {
    assert.equal(cooldownMonthsFor("ppo"), 6);
    assert.equal(cooldownMonthsFor("PPO"), 6);
    assert.equal(cooldownMonthsFor("hmo"), 6);
    assert.equal(cooldownMonthsFor(""), 6);
    assert.equal(cooldownMonthsFor(null), 6);
    assert.equal(cooldownMonthsFor(undefined), 6);
  });
});

describe("computeCooldowns", () => {
  it("uses a 12-month window for Medicare", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        testName: "Colonoscopy",
        dateOfService: "2024-06-01",
        insuranceType: "Medicare",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].cooldownMonths, 12);
    assert.equal(result[0].clearsAt, "2025-06-01");
    assert.equal(result[0].cleared, false);
    assert.equal(result[0].insuranceType, "medicare");
  });

  it("uses a 6-month window for PPO", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        testName: "Colonoscopy",
        dateOfService: "2024-06-01",
        insuranceType: "ppo",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].cooldownMonths, 6);
    assert.equal(result[0].clearsAt, "2024-12-01");
    assert.equal(result[0].cleared, true);
    assert.ok(result[0].daysUntilClear < 0);
  });

  it("returns only the most recent date per test name (most-recent-wins)", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        id: 1,
        testName: "Colonoscopy",
        dateOfService: "2023-01-01",
        insuranceType: "ppo",
      }),
      makeRow({
        id: 2,
        testName: "Colonoscopy",
        dateOfService: "2024-09-15",
        insuranceType: "ppo",
      }),
      makeRow({
        id: 3,
        testName: "Colonoscopy",
        dateOfService: "2024-03-01",
        insuranceType: "ppo",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].lastDate, "2024-09-15");
    assert.equal(result[0].historyId, 2);
  });

  it("treats test names case- and whitespace-insensitively when deduping", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        id: 1,
        testName: "Colonoscopy",
        dateOfService: "2024-01-01",
      }),
      makeRow({
        id: 2,
        testName: "  COLONOSCOPY  ",
        dateOfService: "2024-08-01",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].lastDate, "2024-08-01");
  });

  it("keeps separate entries for distinct test names", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({ testName: "Colonoscopy", dateOfService: "2024-08-01" }),
      makeRow({ testName: "FIT", dateOfService: "2024-09-01" }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 2);
    const names = result.map((r) => r.testName).sort();
    assert.deepEqual(names, ["Colonoscopy", "FIT"]);
  });

  it("marks cleared=true exactly at the cleared/uncleared boundary (clearsAt == today)", () => {
    // PPO 6-month cooldown that clears exactly on `now`.
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        testName: "Colonoscopy",
        dateOfService: "2024-07-01",
        insuranceType: "ppo",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].clearsAt, "2025-01-01");
    assert.equal(result[0].daysUntilClear, 0);
    assert.equal(result[0].cleared, true);
  });

  it("marks cleared=false the day before the clears-at date", () => {
    const now = new Date("2024-12-31T00:00:00");
    const records = [
      makeRow({
        testName: "Colonoscopy",
        dateOfService: "2024-07-01",
        insuranceType: "ppo",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].cleared, false);
    assert.equal(result[0].daysUntilClear, 1);
  });

  it("sorts entries by clearsAt ascending", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        testName: "FIT",
        dateOfService: "2024-12-01",
        insuranceType: "ppo",
      }),
      makeRow({
        testName: "Colonoscopy",
        dateOfService: "2024-06-01",
        insuranceType: "ppo",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 2);
    assert.equal(result[0].testName, "Colonoscopy"); // clears 2024-12-01
    assert.equal(result[1].testName, "FIT");          // clears 2025-06-01
  });

  it("skips records with unparseable service dates", () => {
    const now = new Date("2025-01-01T00:00:00");
    const records = [
      makeRow({
        testName: "Colonoscopy",
        dateOfService: "not-a-date",
      }),
    ];
    const result = computeCooldowns(records, now);
    assert.equal(result.length, 0);
  });

  it("returns an empty array for no records", () => {
    assert.deepEqual(computeCooldowns([], new Date()), []);
  });
});

describe("groupHistoryByPatient", () => {
  it("groups rows with identical name + DOB under one canonical key", () => {
    const rows = [
      makeHistory({ patientName: "Jane Doe", dob: "1980-01-15", testName: "Colonoscopy" }),
      makeHistory({ patientName: "Jane Doe", dob: "1980-01-15", testName: "FIT" }),
    ];
    const map = groupHistoryByPatient(rows);
    const key = patientKey("Jane Doe", "1980-01-15");
    assert.equal(map.size, 1);
    assert.equal(map.get(key)?.length, 2);
  });

  it("groups name variants with the same DOB under the same canonical key", () => {
    const rows = [
      makeHistory({ patientName: "William Smith", dob: "1970-03-04" }),
      makeHistory({ patientName: "Bill Smith", dob: "1970-03-04" }),
    ];
    const map = groupHistoryByPatient(rows);
    assert.equal(map.size, 1);
    const onlyKey = Array.from(map.keys())[0];
    assert.equal(map.get(onlyKey)?.length, 2);
  });

  it("keeps rows with the same name but different DOBs in separate buckets", () => {
    const rows = [
      makeHistory({ patientName: "Jane Doe", dob: "1980-01-15" }),
      makeHistory({ patientName: "Jane Doe", dob: "1992-07-22" }),
    ];
    const map = groupHistoryByPatient(rows);
    assert.equal(map.size, 2);
    for (const list of map.values()) assert.equal(list.length, 1);
  });

  it("returns an empty map when given no rows", () => {
    assert.equal(groupHistoryByPatient([]).size, 0);
  });
});
