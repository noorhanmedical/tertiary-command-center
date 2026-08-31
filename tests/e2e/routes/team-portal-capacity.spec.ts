// Capacity-aware scheduling acceptance (A–N from the milestone spec).
//
// The capacity math is server-owned (the ONE availability engine); the client
// renders those decisions. So these tests drive the canonical write +
// /api/scheduling/availability + /api/scheduling/capacity endpoints directly
// (deterministic, no UI flake), plus one UI assertion that the scheduler
// surfaces capacity labels and one Quick==Full consistency check.
//
// Auth reuses the browser session (loginAs) so page.request carries cookies.

import { test, expect, type APIRequestContext } from "@playwright/test";

const CLINIC = "Taylor Family Practice";
// A far-future, otherwise-empty day so seeded appointments never collide with
// other fixtures. Each test cleans up what it creates.
const DAY = "2027-03-15";

// Seeded screened patients at Taylor (patient_screenings ids). Distinct
// patients so ultrasound turnover applies between them.
const P1 = 1;
const P2 = 2;
const P3 = 3;

async function api(page: import("@playwright/test").Page): Promise<APIRequestContext> {
  const { loginAs } = await import("../fixtures/auth");
  await loginAs(page, "admin");
  return page.request;
}

async function availability(
  req: APIRequestContext,
  services: Array<{ resourceType: string; studyCount?: number }>,
  preferredTime?: string,
) {
  const res = await req.post("/api/scheduling/availability", {
    data: { facility: CLINIC, date: DAY, services, preferredTime },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function schedule(
  req: APIRequestContext,
  patientScreeningId: number,
  serviceType: string,
  time: string,
  metadata: Record<string, unknown> = {},
) {
  const res = await req.post("/api/global-schedule-events/schedule-ancillary", {
    data: {
      patientScreeningId,
      serviceType,
      startsAt: `${DAY}T${time}:00`,
      facilityId: CLINIC,
      metadata: { source: "capacity_e2e", ...metadata },
    },
  });
  const body = await res.json();
  return body?.event?.id ?? null;
}

async function cleanup(req: APIRequestContext, ids: Array<number | null>) {
  // Cancel the created events so the day returns to empty (no hard delete API;
  // the transition endpoint is the canonical mutator).
  for (const id of ids) {
    if (id == null) continue;
    await req
      .post(`/api/global-schedule-events/${id}/transition`, {
        data: { transition: "cancel", note: "capacity e2e cleanup" },
      })
      .catch(() => {});
  }
}

function slotAt(avail: { slots: Array<{ time: string; available: number; total: number; fits: boolean; capacityFits: boolean }> }, time: string) {
  return avail.slots.find((s) => s.time === time)!;
}

test.describe("Capacity engine — resource pools", () => {
  // A — Taylor default resources.
  test("A. Taylor defaults: BrainWave 2, VitalWave 2, Ultrasound 1", async ({ page }) => {
    const req = await api(page);
    const res = await req.get(`/api/scheduling/capacity?facility=${encodeURIComponent(CLINIC)}`);
    const body = await res.json();
    expect(body.effective.brainwave.machineCount).toBe(2);
    expect(body.effective.brainwave.durationMinutes).toBe(45);
    expect(body.effective.vitalwave.machineCount).toBe(2);
    expect(body.effective.vitalwave.durationMinutes).toBe(30);
    expect(body.effective.ultrasound.machineCount).toBe(1);
    expect(body.effective.ultrasound.minutesPerStudy).toBe(15);
    expect(body.effective.ultrasound.turnoverMinutes).toBe(5);
  });

  // B + C — two simultaneous BrainWave allowed; third blocked.
  test("B+C. two BrainWave at 09:00 allowed, third blocked", async ({ page }) => {
    const req = await api(page);
    const ids: Array<number | null> = [];
    try {
      // Empty day → 09:00 shows 2 of 2.
      let a = await availability(req, [{ resourceType: "brainwave" }], "09:00");
      expect(slotAt(a, "09:00").available).toBe(2);

      ids.push(await schedule(req, P1, "BrainWave", "09:00"));
      ids.push(await schedule(req, P2, "BrainWave", "09:00"));

      a = await availability(req, [{ resourceType: "brainwave" }], "09:00");
      // Two machines occupied → third overlapping BrainWave is FULL.
      expect(slotAt(a, "09:00").available).toBe(0);
      expect(slotAt(a, "09:00").fits).toBe(false);
      expect(a.conflict).not.toBeNull();
      // 09:45 is free again (blocks end at 09:45).
      expect(slotAt(a, "09:45").available).toBe(2);
    } finally {
      await cleanup(req, ids);
    }
  });

  // D + E + F — pools independent; two VitalWave allowed; third blocked.
  test("D+E+F. VitalWave independent of BrainWave; 2 allowed, 3rd blocked", async ({ page }) => {
    const req = await api(page);
    const ids: Array<number | null> = [];
    try {
      ids.push(await schedule(req, P1, "BrainWave", "09:00"));
      ids.push(await schedule(req, P2, "BrainWave", "09:00"));
      // D — BrainWave full does NOT affect VitalWave.
      let a = await availability(req, [{ resourceType: "vitalwave" }], "09:00");
      expect(slotAt(a, "09:00").available).toBe(2);

      ids.push(await schedule(req, P1, "VitalWave", "09:00"));
      ids.push(await schedule(req, P2, "VitalWave", "09:00"));
      // F — third VitalWave blocked.
      a = await availability(req, [{ resourceType: "vitalwave" }], "09:00");
      expect(slotAt(a, "09:00").fits).toBe(false);
    } finally {
      await cleanup(req, ids);
    }
  });
});

test.describe("Capacity engine — ultrasound", () => {
  // G + H — 4-study = 60min, 6-study = 90min.
  test("G+H. ultrasound duration = studies × 15", async ({ page }) => {
    const req = await api(page);
    const four = await availability(req, [{ resourceType: "ultrasound", studyCount: 4 }]);
    expect(four.durations.ultrasound).toBe(60);
    const six = await availability(req, [{ resourceType: "ultrasound", studyCount: 6 }]);
    expect(six.durations.ultrasound).toBe(90);
  });

  // I — second ultrasound patient respects the 5-minute turnover.
  test("I. second ultrasound patient starts after 5-min turnover", async ({ page }) => {
    const req = await api(page);
    const ids: Array<number | null> = [];
    try {
      // Patient A: 4 studies from 08:00 → 09:00, +5 turnover → machine free 09:05.
      ids.push(await schedule(req, P1, "Abdominal Ultrasound", "08:00", { ultrasoundStudyCount: 4 }));
      const a = await availability(req, [{ resourceType: "ultrasound", studyCount: 1 }], "09:00");
      // Assert on capacityFits — turnover is a CAPACITY rule, independent of the
      // operating-day soft constraint (DAY may be an ultrasound off-day, which
      // affects `fits` but not the machine-occupancy math being tested here).
      // 09:00 blocked (turnover until 09:05); 09:15 free (single machine, step 15).
      expect(slotAt(a, "09:00").capacityFits).toBe(false);
      expect(slotAt(a, "09:15").capacityFits).toBe(true);
    } finally {
      await cleanup(req, ids);
    }
  });
});

test.describe("Capacity engine — multi-service suggestions", () => {
  // Smart, explained sequencing for BrainWave + VitalWave.
  test("L. multi-service produces explained sequence suggestions", async ({ page }) => {
    const req = await api(page);
    const a = await availability(req, [
      { resourceType: "brainwave" },
      { resourceType: "vitalwave" },
    ]);
    expect(a.suggestions.length).toBeGreaterThanOrEqual(1);
    const best = a.suggestions[0];
    expect(best.recommended).toBe(true);
    expect(best.steps.length).toBe(2);
    // Same patient: second block starts at/after the first ends (no overlap).
    expect(best.steps[1].startMinutes).toBeGreaterThanOrEqual(best.steps[0].endMinutes);
    expect(String(best.reason).length).toBeGreaterThan(0);
  });
});

test.describe("Machine outage workflow", () => {
  // J + K + M — temporary reduction detects conflicts + alerts; restore returns.
  test("J+K+M. override BrainWave 2→1 flags conflicts, alerts, then lifts", async ({ page }) => {
    const req = await api(page);
    const apptIds: Array<number | null> = [];
    let overrideId: number | null = null;
    try {
      apptIds.push(await schedule(req, P1, "BrainWave", "09:00"));
      apptIds.push(await schedule(req, P2, "BrainWave", "09:00"));

      // Create the outage: BrainWave 2 → 1 for the day.
      const created = await req.post(
        `/api/scheduling/capacity/${encodeURIComponent(CLINIC)}/overrides`,
        {
          data: {
            resourceType: "brainwave",
            startDate: DAY,
            endDate: DAY,
            availableCapacity: 1,
            reason: "E2E machine maintenance",
          },
        },
      );
      expect(created.ok()).toBeTruthy();
      const cbody = await created.json();
      overrideId = cbody.override?.id ?? null;

      // K — affected appointments detected (both 09:00 BrainWave over capacity).
      expect(cbody.conflicts).not.toBeNull();
      expect(cbody.conflicts.affected.length).toBe(2);
      expect(cbody.conflicts.reducedCapacity).toBe(1);
      expect(cbody.conflicts.defaultCapacity).toBe(2);
      // L (outage variant) — each affected appointment carries an alternative.
      expect(cbody.conflicts.affected[0].nextAvailable).toBeTruthy();

      // J — availability now reflects reduced capacity (total 1).
      const a = await availability(req, [{ resourceType: "brainwave" }]);
      expect(a.equipment.find((e: { resourceType: string }) => e.resourceType === "brainwave").total).toBe(1);

      // M — lift the override, capacity returns to the default (2).
      const lift = await req.delete(`/api/scheduling/capacity/overrides/${overrideId}`);
      expect(lift.ok()).toBeTruthy();
      overrideId = null;
      const restored = await availability(req, [{ resourceType: "brainwave" }]);
      expect(restored.equipment.find((e: { resourceType: string }) => e.resourceType === "brainwave").total).toBe(2);
    } finally {
      if (overrideId != null) {
        await req.delete(`/api/scheduling/capacity/overrides/${overrideId}`).catch(() => {});
      }
      await cleanup(req, apptIds);
    }
  });
});

test.describe("Quick == Full consistency", () => {
  // N — the availability result is identical regardless of caller; both the
  // full scheduler and quick popover call the SAME endpoint.
  test("N. identical availability for the same inputs", async ({ page }) => {
    const req = await api(page);
    const a1 = await availability(req, [{ resourceType: "brainwave" }], "09:00");
    const a2 = await availability(req, [{ resourceType: "brainwave" }], "09:00");
    expect(JSON.stringify(a1.slots)).toBe(JSON.stringify(a2.slots));
  });
});

test.describe("Scheduler UI surfaces capacity", () => {
  test("time slots show remaining machines and equipment strip renders", async ({ page }) => {
    const { loginAs } = await import("../fixtures/auth");
    await loginAs(page, "admin");
    await page.goto("/patient-care-specialist-portal");
    await page.getByTestId("select-facility").selectOption(CLINIC);
    await page.waitForTimeout(600);
    // Open the full scheduler via the left rail (reveal on hover, then pin).
    await page.mouse.move(4, 450);
    await page.waitForTimeout(300);
    const pin = page.getByTestId("button-pin-left-rail");
    if (await pin.isVisible().catch(() => false)) await pin.click().catch(() => {});
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();
    // Equipment strip is visible (machine totals for the day).
    await expect(page.getByTestId("scheduler-equipment-brainwave")).toBeVisible();
    // Choose BrainWave → capacity labels appear on slots.
    await page.getByTestId("scheduler-service-brainwave").click();
    await expect(page.getByTestId("scheduler-slot-cap-08:00")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("scheduler-slot-cap-08:00")).toContainText("of");
  });
});
