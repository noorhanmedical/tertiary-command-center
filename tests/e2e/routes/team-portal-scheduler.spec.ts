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
    // BrainWave + VitalWave are top-level.
    await expect(page.getByTestId("scheduler-service-brainwave")).toBeVisible();
    await expect(page.getByTestId("scheduler-service-vitalwave")).toBeVisible();
    // Ultrasound opens a dropdown with the registry's ultrasound studies.
    await page.getByTestId("scheduler-service-ultrasound").click();
    await expect(page.getByTestId("scheduler-ultrasound-menu")).toBeVisible();
    const opts = page.locator('[data-testid^="scheduler-ultrasound-option-"]');
    expect(await opts.count()).toBeGreaterThanOrEqual(5);
    // Specific canonical study present.
    await expect(page.getByTestId("scheduler-ultrasound-option-Bilateral Carotid Duplex")).toBeVisible();
  });

  test("time slots render as visible buttons once a service is chosen", async ({ page }) => {
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("scheduler-time-slots")).toBeVisible();
    // Capacity-aware slots appear after a service (resource pool) is selected.
    await page.getByTestId("scheduler-service-brainwave").click();
    await expect(page.getByTestId("scheduler-slot-08:00")).toBeVisible({ timeout: 8000 });
    // Each slot shows remaining machines ("N of M") for the selected service.
    await expect(page.getByTestId("scheduler-slot-cap-08:00")).toBeVisible();
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
    // Popover carries the same fields.
    await expect(page.getByTestId("scheduler-quick-popover").getByTestId("scheduler-service-brainwave")).toBeVisible();
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
    await openPortalAsAdmin(page);
    await pinLeft(page);
    await page.getByTestId("left-rail-tool-calendar").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible();

    // Patient search → pick a seeded patient.
    await page.getByTestId("scheduler-patient-search").fill("testguy");
    const result = page.locator('[data-testid^="scheduler-patient-result-"]').first();
    await expect(result).toBeVisible({ timeout: 8000 });
    await result.click();
    await expect(page.getByTestId("scheduler-patient-name")).toBeVisible();

    // Service (BrainWave) + a time slot.
    await page.getByTestId("scheduler-service-brainwave").click();
    await page.getByTestId("scheduler-slot-09:00").click();

    // Schedule.
    const submit = page.getByTestId("scheduler-submit");
    await expect(submit).toBeEnabled();
    await submit.click();
    // Success surfaces as a toast; the submit re-enables (time cleared) without error.
    await expect(page.getByText(/Scheduled/i).first()).toBeVisible({ timeout: 8000 });
  });
});
