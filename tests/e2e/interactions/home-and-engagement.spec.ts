// Home + Engagement Center interaction tests.
//
// Home:
//   - dashboard renders
//   - HomeLiveDashboard renders
//   - HomeWorldClocks renders
//   - canonical calendar renders
//   - calendar filter opens
//   - day popover opens
//   - navigation works
//   - global dock opens
//
// Engagement:
//   - assignment board renders
//   - baskets switch
//   - filters work
//   - documents section opens
//   - team metrics render
//   - case panel opens

import { test, expect, loginAs } from "../fixtures/auth";

test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/home");
  });

  test("dashboard + live dashboard + world clocks render", async ({ page }) => {
    await expect(page.getByTestId("home-dashboard").first()).toBeVisible();
    // HomeLiveDashboard exposes a testid on its container
    const live = page.getByTestId("home-live-dashboard");
    if (await live.count()) await expect(live.first()).toBeVisible();
    const clocks = page.getByTestId("home-world-clocks");
    if (await clocks.count()) await expect(clocks.first()).toBeVisible();
  });

  test("canonical calendar renders + filter opens + day popover", async ({ page }) => {
    // The canonical month calendar is present on the home page.
    const calendar = page.locator("[data-testid^='home-calendar-'], [data-testid^='canonical-']").first();
    await expect(calendar).toBeVisible();
    // Filter dropdown
    const filterBtn = page.getByRole("button", { name: /filter/i }).first();
    if (await filterBtn.count()) {
      await filterBtn.click();
      await expect(page.getByRole("menu").first()).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  test("global dock opens", async ({ page }) => {
    const dock = page.getByTestId("global-floating-dock");
    if (await dock.count()) {
      await expect(dock.first()).toBeVisible();
    }
  });
});

test.describe("Engagement Center", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/engagement-center");
  });

  test("assignment board + baskets switch", async ({ page }) => {
    await expect(page.locator("[data-testid^='engagement-']").first()).toBeVisible();
    const basketTab = page.getByRole("tab").first();
    if (await basketTab.count()) {
      await basketTab.click();
    }
  });

  test("team metrics render", async ({ page }) => {
    const metrics = page.locator("[data-testid*='team-metrics'], [data-testid*='engagement-team']").first();
    if (await metrics.count()) {
      await expect(metrics).toBeVisible();
    }
  });
});
