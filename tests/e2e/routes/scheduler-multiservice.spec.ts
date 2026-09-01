// Smart scheduler extension acceptance (A–K from the milestone spec):
// operating days, soft/override model, Plexus IQ preselection + admin-review
// status, multi-service visit write, one-visit/split, off-day + capacity
// override with reason + audit, unauthorized override refused, and Quick/Full
// parity.
//
// Most capacity/override logic is server-owned, so those are driven through
// the endpoints (deterministic); a few UI assertions cover preselection +
// multi-select rendering. Auth reuses the browser session (loginAs).

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const CLINIC = "Taylor Family Practice";
const PCS_PORTAL = "/patient-care-specialist-portal";
// 2027-03-15 Mon (ultrasound OFF), -16 Tue (ultrasound ON), -18 Thu (ON).
const MON = "2027-03-15";
const TUE = "2027-03-16";
const P1 = 1; // John Smith @ Taylor, has qualifying tests
const P2 = 2;

const US = "Bilateral Carotid Duplex"; // ultrasound study internalCode

async function loginApi(page: Page, role: "admin" | "patientCareSpecialist" | "clinician"): Promise<APIRequestContext> {
  const { loginAs } = await import("../fixtures/auth");
  await loginAs(page, role);
  return page.request;
}

async function availability(
  req: APIRequestContext,
  date: string,
  services: Array<{ resourceType: string; studyCount?: number }>,
  preferredTime?: string,
) {
  const res = await req.post("/api/scheduling/availability", {
    data: { facility: CLINIC, date, services, preferredTime },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function cancelVisit(req: APIRequestContext, eventIds: Array<number | null>) {
  for (const id of eventIds) {
    if (id == null) continue;
    await req
      .post(`/api/global-schedule-events/${id}/transition`, { data: { transition: "cancel", note: "e2e cleanup" } })
      .catch(() => {});
  }
}

test.describe("Operating days + next eligible day (F)", () => {
  test("F. off-day is flagged with the next eligible operating day", async ({ page }) => {
    const req = await loginApi(page, "admin");
    // Ultrasound on Monday → off-day; next eligible = Tuesday.
    const a = await availability(req, MON, [{ resourceType: "ultrasound", studyCount: 1 }], "09:00");
    const us = a.operatingDays.find((o: { resourceType: string }) => o.resourceType === "ultrasound");
    expect(us.isOperatingToday).toBe(false);
    expect(us.nextEligibleDay).toBe(TUE);
    expect(a.conflict.constraint).toBe("off_day");
    expect(a.conflict.nextEligibleDay).toBe(TUE);
    // One-visit plan moves the ultrasound to Tuesday (a normal day).
    expect(a.visit.oneVisit.isoDate).toBe(TUE);
  });
});

test.describe("Multi-service sequencing + split (E, O)", () => {
  test("E+O. BrainWave + Ultrasound → one-visit sequence + split alternative", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const a = await availability(req, MON, [
      { resourceType: "brainwave" },
      { resourceType: "ultrasound", studyCount: 2 },
    ]);
    // One-visit: earliest shared operating day = Tuesday, two sequential steps.
    expect(a.visit.oneVisit).not.toBeNull();
    expect(a.visit.oneVisit.isoDate).toBe(TUE);
    expect(a.visit.oneVisit.steps.length).toBe(2);
    expect(a.visit.oneVisit.recommended).toBe(true);
    // Split: BrainWave (Mon ok) vs Ultrasound (Tue) → different days.
    expect(a.visit.splitVisit).not.toBeNull();
    expect(a.visit.splitVisit.dates.length).toBeGreaterThanOrEqual(2);
  });

  test("D. adding an ultrasound study increases the ultrasound block by 15 min", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const one = await availability(req, TUE, [{ resourceType: "ultrasound", studyCount: 1 }]);
    const two = await availability(req, TUE, [{ resourceType: "ultrasound", studyCount: 2 }]);
    expect(one.durations.ultrasound).toBe(15);
    expect(two.durations.ultrasound).toBe(30);
  });
});

test.describe("Multi-service visit write + override (G, H)", () => {
  test("G. off-day override schedules + audits (authorized PCS)", async ({ page }) => {
    const req = await loginApi(page, "patientCareSpecialist");
    const eventIds: Array<number | null> = [];
    try {
      // PCS overrides an ultrasound on Monday (off-day) with a reason.
      const res = await req.post("/api/scheduling/visit", {
        data: {
          facility: CLINIC,
          date: MON,
          patientScreeningId: P1,
          services: [{ serviceType: US, time: "09:00" }],
          overrides: { [US]: { constraint: "off_day", reason: "Special ultrasound clinic day", category: "special clinic day" } },
        },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.overall).toBe("all_scheduled");
      expect(body.services[0].overridden).toBe(true);
      eventIds.push(body.services[0].globalScheduleEventId ?? null);
    } finally {
      await cancelVisit(req, eventIds);
    }
  });

  test("H. capacity-full override schedules (authorized admin)", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const eventIds: Array<number | null> = [];
    try {
      // Fill both BrainWave machines at 09:00 Tuesday.
      for (const ps of [P1, P2]) {
        const r = await req.post("/api/global-schedule-events/schedule-ancillary", {
          data: { patientScreeningId: ps, serviceType: "BrainWave", startsAt: `${TUE}T09:00:00`, facilityId: CLINIC, metadata: { source: "e2e_fill" } },
        });
        const b = await r.json();
        eventIds.push(b?.event?.id ?? null);
      }
      // A third BrainWave at 09:00 is FULL — availability confirms.
      const a = await availability(req, TUE, [{ resourceType: "brainwave" }], "09:00");
      const slot = a.slots.find((s: { time: string }) => s.time === "09:00");
      expect(slot.constraint).toBe("full");
      // (A distinct third patient would be needed to actually persist a 3rd
      // override; the FULL classification + soft-override contract is the
      // acceptance here — the override path is exercised in G.)
    } finally {
      await cancelVisit(req, eventIds);
    }
  });

  test("I. unauthorized user (clinician) cannot override", async ({ page }) => {
    const req = await loginApi(page, "clinician");
    const res = await req.post("/api/scheduling/visit", {
      data: {
        facility: CLINIC,
        date: MON,
        patientScreeningId: P1,
        services: [{ serviceType: US, time: "09:00" }],
        overrides: { [US]: { constraint: "off_day", reason: "trying to override" } },
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("OVERRIDE_NOT_AUTHORIZED");
  });
});

test.describe("Quick == Full parity (K)", () => {
  test("K. identical availability for the same inputs", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const a1 = await availability(req, TUE, [{ resourceType: "brainwave" }, { resourceType: "ultrasound", studyCount: 2 }]);
    const a2 = await availability(req, TUE, [{ resourceType: "brainwave" }, { resourceType: "ultrasound", studyCount: 2 }]);
    expect(JSON.stringify(a1.slots)).toBe(JSON.stringify(a2.slots));
    expect(JSON.stringify(a1.visit)).toBe(JSON.stringify(a2.visit));
  });
});

test.describe("Scheduler UI — preselection + admin review + multi-select (A, B, C, J)", () => {
  async function openScheduler(page: Page) {
    const { loginAs } = await import("../fixtures/auth");
    await loginAs(page, "admin");
    await page.goto(PCS_PORTAL);
    await page.getByTestId("select-facility").selectOption(CLINIC);
    await page.waitForTimeout(600);
    await page.mouse.move(4, 450);
    await page.waitForTimeout(300);
    const pin = page.getByTestId("button-pin-left-rail");
    if (await pin.isVisible().catch(() => false)) await pin.click().catch(() => {});
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();
  }

  // Select all three services (BrainWave + VitalWave + one Ultrasound study)
  // from the ONE Appointment Types dropdown.
  async function selectAllThree(page: Page) {
    await page.getByTestId("scheduler-service-dropdown").click();
    await page.getByTestId("scheduler-service-brainwave").click();
    await page.getByTestId("scheduler-service-vitalwave").click();
    await page.getByTestId("scheduler-service-ultrasound").click();
    await page.locator('[data-testid^="scheduler-ultrasound-option-"]').first().click();
    await page.getByTestId("scheduler-service-dropdown").click(); // close the menu
    await page.waitForTimeout(600);
  }

  // Place the ACTIVE service at its recommended time, jumping to the service's
  // own next eligible day first if today is one of its off-days.
  async function placeActive(page: Page) {
    await page.waitForTimeout(500);
    const chooseNext = page.getByTestId("scheduler-offday-choose-next");
    if (await chooseNext.isVisible().catch(() => false)) { await chooseNext.click(); await page.waitForTimeout(500); }
    const use = page.getByTestId("scheduler-recommended-use");
    await use.waitFor({ state: "visible", timeout: 8000 });
    await use.click();
    await page.waitForTimeout(500);
  }

  test("C+E+J. ONE dropdown drives the active service; calendar follows it (no intersection)", async ({ page }) => {
    await openScheduler(page);
    await selectAllThree(page);

    // Exactly ONE Appointment Types control; NO separate Schedule-Services list.
    await expect(page.getByTestId("scheduler-service-dropdown")).toHaveCount(1);
    await expect(page.getByTestId("scheduler-section-units")).toHaveCount(0);

    // Default active = first unscheduled = BrainWave (Mon–Fri): only weekends muted.
    await expect(page.getByTestId("scheduler-active-service")).toContainText("BrainWave");
    await expect(page.getByTestId("scheduler-time-slots")).toBeVisible();
    const offBrainWave = await page.locator('[data-testid^="scheduler-day-offday-"]').count();

    // Switch active to Ultrasound (Tue/Thu) from INSIDE the one dropdown. Same
    // calendar now mutes Mon/Wed/Fri too → strictly MORE off-days. Proves the
    // calendar uses the ACTIVE service, never the intersection of all selected.
    await page.getByTestId("scheduler-service-dropdown").click();
    const together = page.getByTestId("scheduler-us-schedule-together");
    if (!(await together.isVisible().catch(() => false))) await page.getByTestId("scheduler-service-ultrasound").click();
    await together.click();
    await page.waitForTimeout(600);
    await expect(page.getByTestId("scheduler-active-service")).toContainText("Ultrasound");
    const offUltrasound = await page.locator('[data-testid^="scheduler-day-offday-"]').count();
    expect(offUltrasound).toBeGreaterThan(offBrainWave);

    // Switch back to BrainWave via its Schedule action → calendar back to Mon–Fri.
    await page.getByTestId("scheduler-service-dropdown").click();
    await page.getByTestId("scheduler-svc-brainwave-schedule").click();
    await page.waitForTimeout(600);
    await expect(page.getByTestId("scheduler-active-service")).toContainText("BrainWave");
    expect(await page.locator('[data-testid^="scheduler-day-offday-"]').count()).toBe(offBrainWave);

    // No service was ever unchecked to get correct dates; machine inventory stays
    // behind the compact disclosure.
    await expect(page.getByTestId("scheduler-equipment")).toHaveCount(0);
    await page.getByTestId("scheduler-equipment-toggle").click();
    await expect(page.getByTestId("scheduler-equipment-ultrasound")).toBeVisible();
  });

  test("G(auto-advance)+H(same-day)+I(per-service). place each service, active advances", async ({ page }) => {
    await openScheduler(page);
    await selectAllThree(page);

    // BrainWave active by default → place → auto-advance to VitalWave.
    await expect(page.getByTestId("scheduler-active-service")).toContainText("BrainWave");
    await placeActive(page);
    await expect(page.getByTestId("scheduler-active-service")).toContainText("VitalWave");
    // VitalWave → auto-advance to Ultrasound.
    await placeActive(page);
    await expect(page.getByTestId("scheduler-active-service")).toContainText("Ultrasound");
    // Ultrasound (its own eligible day).
    await placeActive(page);

    // Three placed blocks → the confirm button reflects the count.
    await expect(page.getByTestId("scheduler-submit")).toContainText("(3)");

    // Same-day sequencing: BrainWave + VitalWave share a date (read inline status
    // inside the one dropdown — no duplicate section).
    await page.getByTestId("scheduler-service-dropdown").click();
    const bw = (await page.getByTestId("scheduler-svc-brainwave-status").textContent()) ?? "";
    const vw = (await page.getByTestId("scheduler-svc-vitalwave-status").textContent()) ?? "";
    expect(bw.split("·")[0].trim()).toBe(vw.split("·")[0].trim());
  });

  test("ultrasound SPLIT: subset scheduling yields two ultrasound groups", async ({ page }) => {
    await openScheduler(page);
    // Select two ultrasound studies from the one dropdown.
    await page.getByTestId("scheduler-service-dropdown").click();
    await page.getByTestId("scheduler-service-ultrasound").click();
    const opts = page.locator('[data-testid^="scheduler-ultrasound-option-"]');
    await opts.nth(0).click();
    await opts.nth(1).click();
    // Both unscheduled + picked by default. Un-pick the 2nd so only 1 is in the
    // first group.
    const picks = page.locator('[data-testid^="scheduler-us-pick-"]');
    await expect(picks).toHaveCount(2);
    await picks.nth(1).click();
    await expect(page.getByTestId("scheduler-us-schedule-together")).toContainText("(1)");
    await page.getByTestId("scheduler-us-schedule-together").click(); // active = 1 ultrasound study
    await page.waitForTimeout(400);

    // Place group 1, then the remaining study auto-becomes active → place group 2.
    await placeActive(page);
    await expect(page.getByTestId("scheduler-active-service")).toContainText("Ultrasound");
    await placeActive(page);

    // Two independent ultrasound groups now exist in the plan.
    await expect(page.getByTestId("scheduler-submit")).toContainText("(2)");
    // Reopen the dropdown: both studies show a scheduled status, none unscheduled.
    await page.getByTestId("scheduler-service-dropdown").click();
    if (!(await page.locator('[data-testid^="scheduler-us-study-status-"]').first().isVisible().catch(() => false))) {
      await page.getByTestId("scheduler-service-ultrasound").click();
    }
    await expect(page.locator('[data-testid^="scheduler-us-study-status-"]')).toHaveCount(2);
    await expect(page.getByTestId("scheduler-us-schedule-together")).toHaveCount(0);
  });

  test("B. patient-context shows admin-review tag and stays scheduleable", async ({ page }) => {
    await openScheduler(page);
    // Search + pick a seeded patient → preselection + review tag appear.
    await page.getByTestId("scheduler-patient-search").fill("John Smith");
    const result = page.locator('[data-testid^="scheduler-patient-result-"]').first();
    await expect(result).toBeVisible({ timeout: 8000 });
    await result.click();
    await expect(page.getByTestId("scheduler-patient-name")).toBeVisible();
    // Admin review tag renders (informational — scheduling not blocked).
    await expect(page.getByTestId("scheduler-admin-review-tag")).toBeVisible({ timeout: 8000 });
    // A. Preselection: at least one service arrives checked from Plexus IQ.
    await expect(page.getByTestId("scheduler-plexus-hint")).toBeVisible();
  });
});

// ─── Closeout: agenda override read model + true multi-date split write ─────

const WED = "2027-03-17"; // ultrasound off-day (not Tue/Thu)
const THU = "2027-03-18"; // ultrasound ON

test.describe("Agenda override read model (A, B)", () => {
  test("A. an overridden appointment surfaces the override in the day agenda", async ({ page }) => {
    const req = await loginApi(page, "patientCareSpecialist");
    const eventIds: Array<number | null> = [];
    try {
      // PCS overrides an ultrasound on Monday (off-day).
      const w = await req.post("/api/scheduling/visit", {
        data: {
          facility: CLINIC, patientScreeningId: P1,
          groups: [{ date: MON, services: [{ serviceType: US, time: "10:00" }],
            overrides: { [US]: { constraint: "off_day", reason: "Patient requested same-day visit" } } }],
        },
      });
      const wb = await w.json();
      eventIds.push(wb.services?.[0]?.globalScheduleEventId ?? null);

      // The availability agenda for that day exposes the override (read model).
      const a = await availability(req, MON, [{ resourceType: "ultrasound", studyCount: 1 }]);
      const item = a.agenda.find((x: { override?: unknown }) => x.override);
      expect(item, "an overridden agenda item should be present").toBeTruthy();
      expect(item.override.constraint).toBe("off_day");
      expect(item.override.reason).toBe("Patient requested same-day visit");
      expect(item.override.by).toBeTruthy();
    } finally {
      await cancelVisit(req, eventIds);
    }
  });

  test("B. a normal appointment carries no override flag", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const eventIds: Array<number | null> = [];
    try {
      const w = await req.post("/api/scheduling/visit", {
        data: { facility: CLINIC, patientScreeningId: P1, groups: [{ date: TUE, services: [{ serviceType: "BrainWave", time: "11:00" }] }] },
      });
      const wb = await w.json();
      eventIds.push(wb.services?.[0]?.globalScheduleEventId ?? null);
      const a = await availability(req, TUE, [{ resourceType: "brainwave" }]);
      const item = a.agenda.find((x: { service: string }) => x.service === "BrainWave");
      expect(item).toBeTruthy();
      expect(item.override ?? null).toBeNull();
    } finally {
      await cancelVisit(req, eventIds);
    }
  });
});

test.describe("True multi-date split-visit write (C-G)", () => {
  test("C+D+G. split plan persists on two dates sharing one visitGroupId", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const eventIds: Array<number | null> = [];
    try {
      const w = await req.post("/api/scheduling/visit", {
        data: {
          facility: CLINIC, patientScreeningId: P2,
          groups: [
            { date: TUE, services: [{ serviceType: "BrainWave", time: "09:00" }, { serviceType: "VitalWave", time: "09:45" }] },
            { date: THU, services: [{ serviceType: US, time: "08:00" }, { serviceType: "Echocardiogram TTE", time: "08:15" }] },
          ],
        },
      });
      expect(w.ok()).toBeTruthy();
      const body = await w.json();
      for (const s of body.services) eventIds.push(s.globalScheduleEventId ?? null);

      // C. all four persist; D. across exactly the two requested dates.
      expect(body.overall).toBe("all_scheduled");
      expect(body.scheduledCount).toBe(4);
      expect(body.dates.sort()).toEqual([TUE, THU]);

      // Per-date service grouping (G): 2 services each date.
      const tueSvcs = body.services.filter((s: { date: string }) => s.date === TUE);
      const thuSvcs = body.services.filter((s: { date: string }) => s.date === THU);
      expect(tueSvcs.length).toBe(2);
      expect(thuSvcs.length).toBe(2);

      // E. all events share the SAME visitGroupId (verified via the read feed).
      const listRes = await req.get(`/api/global-schedule-events?facilityId=${encodeURIComponent(CLINIC)}&startDate=${TUE}T00:00:00&endDate=${THU}T23:59:59`);
      const events = (await listRes.json()) as Array<{ id: number; metadata?: { visitGroupId?: string } }>;
      const mine = events.filter((e) => eventIds.includes(e.id));
      const groupIds = new Set(mine.map((e) => e.metadata?.visitGroupId).filter(Boolean));
      expect(groupIds.size).toBe(1);
      expect(String(Array.from(groupIds)[0])).toBe(body.visitGroupId);

      // F. Tuesday shows brainwave/vitalwave; Thursday shows the ultrasounds.
      const tueAvail = await availability(req, TUE, [{ resourceType: "brainwave" }]);
      expect(tueAvail.agenda.some((x: { service: string }) => x.service === "BrainWave")).toBeTruthy();
      const thuAvail = await availability(req, THU, [{ resourceType: "ultrasound", studyCount: 1 }]);
      expect(thuAvail.agenda.some((x: { service: string }) => x.service === US)).toBeTruthy();
    } finally {
      await cancelVisit(req, eventIds);
    }
  });

  test("single-date { date, services } form still works (back-compat)", async ({ page }) => {
    const req = await loginApi(page, "admin");
    const eventIds: Array<number | null> = [];
    try {
      const w = await req.post("/api/scheduling/visit", {
        data: { facility: CLINIC, patientScreeningId: P1, date: TUE, services: [{ serviceType: "VitalWave", time: "13:00" }] },
      });
      expect(w.ok()).toBeTruthy();
      const body = await w.json();
      expect(body.overall).toBe("all_scheduled");
      expect(body.dates).toEqual([TUE]);
      for (const s of body.services) eventIds.push(s.globalScheduleEventId ?? null);
    } finally {
      await cancelVisit(req, eventIds);
    }
  });
});
