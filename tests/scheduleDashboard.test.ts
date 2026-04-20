import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIso,
  ancillaryCounts,
  canonicalDay,
  monthGridDates,
  s,
  startOfWeekIso,
} from "../server/services/scheduleDashboardService";

describe("schedule dashboard utilities", () => {
  describe("s()", () => {
    it("trims strings and coerces null/undefined to empty", () => {
      assert.equal(s("  hello  "), "hello");
      assert.equal(s(null), "");
      assert.equal(s(undefined), "");
      assert.equal(s(42), "42");
    });
  });

  describe("canonicalDay()", () => {
    it("extracts the YYYY-MM-DD prefix from an ISO timestamp", () => {
      assert.equal(canonicalDay("2025-01-15T13:45:00.000Z"), "2025-01-15");
    });
    it("handles already-canonical date strings", () => {
      assert.equal(canonicalDay("2025-01-15"), "2025-01-15");
    });
    it("returns empty string for null/undefined", () => {
      assert.equal(canonicalDay(null), "");
      assert.equal(canonicalDay(undefined), "");
    });
  });

  describe("startOfWeekIso()", () => {
    it("returns Monday for a mid-week date (Wednesday → Monday)", () => {
      // 2025-01-15 is a Wednesday
      assert.equal(startOfWeekIso("2025-01-15"), "2025-01-13");
    });
    it("returns the same date when given a Monday", () => {
      // 2025-01-13 is a Monday
      assert.equal(startOfWeekIso("2025-01-13"), "2025-01-13");
    });
    it("rolls Sunday back to the previous Monday", () => {
      // 2025-01-19 is a Sunday → previous Monday is 2025-01-13
      assert.equal(startOfWeekIso("2025-01-19"), "2025-01-13");
    });
    it("crosses a month boundary correctly", () => {
      // 2025-02-01 is a Saturday → Monday is 2025-01-27
      assert.equal(startOfWeekIso("2025-02-01"), "2025-01-27");
    });
  });

  describe("addDaysIso()", () => {
    it("adds positive days", () => {
      assert.equal(addDaysIso("2025-01-15", 7), "2025-01-22");
    });
    it("subtracts when given negative days", () => {
      assert.equal(addDaysIso("2025-01-15", -7), "2025-01-08");
    });
    it("crosses month boundaries", () => {
      assert.equal(addDaysIso("2025-01-31", 1), "2025-02-01");
    });
    it("crosses year boundaries", () => {
      assert.equal(addDaysIso("2024-12-31", 1), "2025-01-01");
    });
    it("handles leap day arithmetic", () => {
      assert.equal(addDaysIso("2024-02-28", 1), "2024-02-29");
      assert.equal(addDaysIso("2024-02-29", 1), "2024-03-01");
    });
  });

  describe("monthGridDates()", () => {
    it("returns 42 consecutive days starting on a Monday", () => {
      const dates = monthGridDates("2025-01-15");
      assert.equal(dates.length, 42);
      // First day must be a Monday
      const [y, m, d] = dates[0].split("-").map(Number);
      assert.equal(new Date(y, m - 1, d).getDay(), 1);
      // Days must be consecutive
      for (let i = 1; i < dates.length; i++) {
        assert.equal(dates[i], addDaysIso(dates[i - 1], 1));
      }
    });

    it("includes the first day of the requested month", () => {
      const dates = monthGridDates("2025-01-15");
      assert.ok(dates.includes("2025-01-01"));
    });

    it("starts on or before the first of the month", () => {
      const dates = monthGridDates("2025-02-10");
      assert.ok(dates[0] <= "2025-02-01");
      assert.ok(dates.includes("2025-02-01"));
    });
  });

  describe("ancillaryCounts()", () => {
    it("counts each test name occurrence", () => {
      assert.deepEqual(
        ancillaryCounts(["Colonoscopy", "FIT", "Colonoscopy"]),
        { Colonoscopy: 2, FIT: 1 },
      );
    });
    it("trims whitespace and skips empty entries", () => {
      assert.deepEqual(
        ancillaryCounts(["  Colonoscopy ", "", "Colonoscopy"]),
        { Colonoscopy: 2 },
      );
    });
    it("returns an empty object for an empty list", () => {
      assert.deepEqual(ancillaryCounts([]), {});
    });
  });
});
