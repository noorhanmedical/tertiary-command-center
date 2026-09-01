// Unified Team Portal scheduler acceptance (scheduling consolidation).
//
// Verifies the ONE full Scheduler + ONE Quick Schedule popover model:
// same scheduler from every entry point, BrainWave/VitalWave top-level +
// Ultrasound dropdown from the canonical registry, visible time-slot buttons,
// full month with no page scroll, double-click quick popover, and a real
// canonical schedule write. Auth uses env PLAYWRIGHT_TEST_* via loginAs.

import { test, expect } from "../fixtures/auth";

const PCS_PORTAL = "/patient-care-specialist-portal";
const CLINIC = "Taylor Family Practice";

async function openPortalAsAdmin(page: import("@playwright/test").Page) {
  const { loginAs } = await import("../fixtures/auth");
  await loginAs(page, "admin");
  await page.goto(PCS_PORTAL);
  await page.getByTestId("select-facility").selectOption(CLINIC);
  await page.waitForTimeout(800);
}
async function pinLeft(page: import("@playwright/test").Page) {
  await page.mouse.move(4, 450);
  await page.waitForTimeout(300);
  const pin = page.getByTestId("button-pin-left-rail");
  if (await pin.isVisible().catch(() => false)) await pin.click().catch(() => {});
  await page.waitForTimeout(300);
}

// B + K + I + J — Left rail Calendar tile opens the full Scheduler; month fits
// without page scroll; Ultrasound dropdown lists all configured studies; time
// slots are visible buttons.
test.describe("Unified full Scheduler", () => {
  test("left-rail Calendar opens the full Scheduler (generic, no patient)", async ({ page }) => {
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();
    await expect(page.getByTestId("scheduler-title")).toHaveText("Schedule");
    // Generic entry → patient search is shown (no patient preselected).
    await expect(page.getByTestId("scheduler-patient-search")).toBeVisible();
  });

  test("full month is visible without page scroll", async ({ page }) => {
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("scheduler-calendar")).toBeVisible();
    const fits = await page.evaluate(() => {
      const cal = document.querySelector('[data-testid="scheduler-calendar"]');
      if (!cal) return false;
      return cal.getBoundingClientRect().bottom <= window.innerHeight + 1 && window.scrollY === 0;
    });
    expect(fits).toBe(true);
  });

  test("Ultrasound is one dropdown of all active configured studies", async ({ page }) => {
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    // Appointment types is a compact dropdown; open it to reveal the options.
    await page.getByTestId("scheduler-service-dropdown").click();
    // BrainWave + VitalWave are top-level inside the menu.
    await expect(page.getByTestId("scheduler-service-brainwave")).toBeVisible();
    await expect(page.getByTestId("scheduler-service-vitalwave")).toBeVisible();
    // Ultrasound opens a nested sub-dropdown with the registry's studies.
    await page.getByTestId("scheduler-service-ultrasound").click();
    await expect(page.getByTestId("scheduler-ultrasound-menu")).toBeVisible();
    const opts = page.locator('[data-testid^="scheduler-ultrasound-option-"]');
    expect(await opts.count()).toBeGreaterThanOrEqual(5);
    // Specific canonical study present.
    await expect(page.getByTestId("scheduler-ultrasound-option-Bilateral Carotid Duplex")).toBeVisible();
  });

  test("time grid renders 15-min slots once a service is chosen", async ({ page }) => {
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    // Choose BrainWave from the dropdown → the capacity-aware grid appears.
    await page.getByTestId("scheduler-service-dropdown").click();
    await page.getByTestId("scheduler-service-brainwave").click();
    await expect(page.getByTestId("scheduler-time-slots")).toBeVisible({ timeout: 8000 });
    // 15-minute resolution (no machine-count text on the buttons).
    await expect(page.getByTestId("scheduler-slot-08:00")).toBeVisible();
    await expect(page.getByTestId("scheduler-slot-08:15")).toBeVisible();
    await expect(page.getByTestId("scheduler-slot-08:30")).toBeVisible();
    await expect(page.getByTestId("scheduler-slot-08:45")).toBeVisible();
  });
});

// G — Double-click a date opens the Quick Schedule popover and does NOT open a
// second full scheduler.
test.describe("Quick Schedule popover", () => {
  test("double-click a date opens the quick popover in place", async ({ page }) => {
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();
    const beforeTabs = await page.locator('[data-testid="playground-tab-bar"] [role="tab"]').count();
    await page.locator('[data-testid^="scheduler-day-"]').nth(15).dblclick();
    await expect(page.getByTestId("scheduler-quick-popover")).toBeVisible();
    // No extra scheduler tab was opened.
    const afterTabs = await page.locator('[data-testid="playground-tab-bar"] [role="tab"]').count();
    expect(afterTabs).toBe(beforeTabs);
    // Popover carries the same appointment-types dropdown; opening it reveals
    // the same BrainWave option as the full scheduler.
    const pop = page.getByTestId("scheduler-quick-popover");
    await pop.getByTestId("scheduler-service-dropdown").click();
    await expect(pop.getByTestId("scheduler-service-brainwave")).toBeVisible();
  });
});

// F — Patient-context entry: opening the scheduler with a patient preselected
// shows the patient summary (not the search box). Uses a call-list row when
// one exists; skips cleanly when the queue is empty for this fixture.
test.describe("Patient-context scheduler", () => {
  test("right-rail patient schedule opens the same Scheduler with the patient", async ({ page }) => {
    await openPortalAsAdmin(page);
    // Reveal the right rail (Work Queue) and look for a call-list row schedule action.
    await page.mouse.move(page.viewportSize()!.width - 4, 450);
    await page.waitForTimeout(400);
    const scheduleBtn = page.locator('[data-testid^="button-call-schedule-"], [data-testid^="button-patient-calendar-"]').first();
    if (!(await scheduleBtn.isVisible().catch(() => false))) {
      test.skip(true, "No schedulable patient row in this fixture/date");
      return;
    }
    await scheduleBtn.click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();
    // Patient summary (not the search box) is shown for patient-context entry.
    await expect(page.getByTestId("scheduler-patient-name")).toBeVisible();
  });
});

// E — Generic scheduling end-to-end: search patient → service → date → time →
// Schedule → success (the write goes through the canonical path).
test.describe("Generic scheduling write", () => {
  test("search patient, pick service + time, Schedule succeeds", async ({ page }) => {
    // A fixed far-future BrainWave operating day (Tuesday) so the write never
    // collides with "today" on reruns; cleaned up via the canonical mutator.
    const TARGET = "2027-03-16";
    async function cancelPatientDay(psid: number) {
      const res = await page.request.get(
        `/api/global-schedule-events?facilityId=${encodeURIComponent(CLINIC)}&patientScreeningId=${psid}&startDate=${TARGET}T00:00:00&endDate=${TARGET}T23:59:59`,
      );
      if (!res.ok()) return;
      const events = (await res.json()) as Array<{ id: number }>;
      for (const e of events) {
        await page.request
          .post(`/api/global-schedule-events/${e.id}/transition`, { data: { transition: "cancel", note: "e2e cleanup" } })
          .catch(() => {});
      }
    }

    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();

    // Patient search → pick a seeded patient; capture its screening id.
    await page.getByTestId("scheduler-patient-search").fill("testguy");
    const result = page.locator('[data-testid^="scheduler-patient-result-"]').first();
    await expect(result).toBeVisible({ timeout: 8000 });
    const rid = (await result.getAttribute("data-testid")) ?? "";
    const psid = Number(rid.split("-").pop());
    await result.click();
    await expect(page.getByTestId("scheduler-patient-name")).toBeVisible();
    // Pre-clean any leftover from a prior run so placement isn't deduped.
    if (Number.isFinite(psid)) await cancelPatientDay(psid);

    // Service (BrainWave) from the dropdown, then close the menu.
    await page.getByTestId("scheduler-service-dropdown").click();
    const bw = page.getByTestId("scheduler-service-brainwave");
    if ((await bw.getAttribute("aria-pressed")) !== "true") await bw.click();
    await page.getByTestId("scheduler-service-dropdown").click(); // close menu

    // Navigate the month calendar to the fixed target date.
    const cell = page.getByTestId(`scheduler-day-${TARGET}`);
    for (let i = 0; i < 24 && !(await cell.isVisible().catch(() => false)); i++) {
      await page.getByTestId("scheduler-next-month").click();
      await page.waitForTimeout(120);
    }
    await cell.click();
    await page.waitForTimeout(500);

    // Assign the recommended time for the active BrainWave unit.
    const use = page.getByTestId("scheduler-recommended-use");
    await use.waitFor({ state: "visible", timeout: 8000 });
    await use.click();

    // Review & Confirm → the confirmation summary → Confirm Schedule.
    const submit = page.getByTestId("scheduler-submit");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId("scheduler-confirm-dialog")).toBeVisible();
    await page.getByTestId("scheduler-confirm-schedule").click();
    // Success surfaces as a toast.
    await expect(page.getByText(/Scheduled/i).first()).toBeVisible({ timeout: 8000 });

    // Clean up the event this test created.
    if (Number.isFinite(psid)) await cancelPatientDay(psid);
  });
});
