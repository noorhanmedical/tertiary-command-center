// Team Portal rail refinement + messaging (Stage 1/2) acceptance.
//
// Covers the canonical clinic selector fix + selected-clinic messaging tenancy
// + Direct compose + calendar service dots. Requires a running dev server with
// seeded fixtures. Auth uses the env-configured PLAYWRIGHT_TEST_* creds via the
// shared loginAs fixture (skips cleanly when a role's creds aren't set).
//
// Canonical clinics (Admin Settings `clinics`, active): Taylor Family Practice,
// Life Medical Center. "Plexus Imaging"/"Plexus Neuro" are NON-canonical legacy
// strings that must NOT appear in the selector.

import { test, expect } from "../fixtures/auth";

const PCS_PORTAL = "/patient-care-specialist-portal";

async function revealLeftRail(page: import("@playwright/test").Page) {
  // Pin the left rail open via its pin button (hover reveals the header).
  await page.mouse.move(4, 450);
  await page.waitForTimeout(300);
  const pin = page.getByTestId("button-pin-left-rail");
  if (await pin.isVisible().catch(() => false)) await pin.click().catch(() => {});
  await page.waitForTimeout(300);
}

// A — Admin clinic selector contains ONLY canonical Admin Settings clinics.
test.describe("Team Portal clinic selector (canonical)", () => {
  test("admin selector lists canonical clinics, not legacy 'Plexus Imaging'", async ({ page }) => {
    const { loginAs } = await import("../fixtures/auth");
    await loginAs(page, "admin");
    await page.goto(PCS_PORTAL);
    const sel = page.getByTestId("select-facility");
    await expect(sel).toBeVisible();
    const options = (await sel.locator("option").allTextContents()).map((s) => s.trim());
    // Canonical active clinics present.
    expect(options).toContain("Taylor Family Practice");
    // Legacy non-canonical facility strings must be gone.
    expect(options).not.toContain("Plexus Imaging");
    expect(options).not.toContain("Plexus Neuro");
  });
});

// B + C — Admin messaging: no clinic → "Select a clinic to use messaging";
// after selecting a clinic → messaging becomes available (compose visible).
test.describe("Admin selected-clinic messaging", () => {
  test("selecting a clinic enables messaging + New Message compose", async ({ page }) => {
    const { loginAs } = await import("../fixtures/auth");
    await loginAs(page, "admin");
    await page.goto(PCS_PORTAL);

    // Select the canonical Taylor Family Practice clinic.
    await page.getByTestId("select-facility").selectOption("Taylor Family Practice");
    await page.waitForTimeout(800);

    await revealLeftRail(page);
    await page.getByTestId("left-panel-tab-messaging").click();

    // Messaging available: the New Message compose control is present.
    const newBtn = page.getByTestId("messages-new-message");
    await expect(newBtn).toBeVisible();

    // Compose opens a searchable people picker with real roster entries.
    await newBtn.click();
    await expect(page.getByTestId("messages-compose-picker")).toBeVisible();
    const people = page.locator('[data-testid^="messages-compose-person-"]');
    await expect(people.first()).toBeVisible();

    // Picking a person opens a conversation (the floating window appears).
    await people.first().click();
    await expect(page.getByTestId("portal-messages-window")).toBeVisible();
    // The one clear Close control exists; dead controls are gone.
    await expect(page.getByTestId("messages-window-close")).toBeVisible();
    await expect(page.getByTestId("messages-window-plus")).toHaveCount(0);
  });
});

// G — Calendar shows canonical service dots for a facility with scheduled
// ancillary activity (Taylor Family Practice has a dated batch with
// brainwave/vitalwave/ultrasound categories in the current month window).
test.describe("Left-rail calendar service dots", () => {
  test("selecting Taylor Family Practice lights canonical ancillary dots", async ({ page }) => {
    const { loginAs } = await import("../fixtures/auth");
    await loginAs(page, "admin");
    await page.goto(PCS_PORTAL);
    await page.getByTestId("select-facility").selectOption("Taylor Family Practice");
    await page.waitForTimeout(800);
    await revealLeftRail(page);
    const cal = page.getByTestId("left-rail-compact-calendar");
    await expect(cal).toBeVisible();
    // At least one day cell renders canonical service dots.
    const dotDays = page.locator('[data-testid^="left-rail-compact-calendar-dots-"]');
    await expect(dotDays.first()).toBeVisible();
  });
});

// D + E — PCS / ACS clinic-scoped messaging compose (skips if creds unset).
for (const role of ["patientCareSpecialist", "ancillaryCareSpecialist"] as const) {
  test.describe(`${role} messaging compose`, () => {
    const portal =
      role === "patientCareSpecialist"
        ? PCS_PORTAL
        : "/ancillary-care-specialist-portal";
    test("Direct New Message picker lists eligible teammates", async ({ page }) => {
      const { loginAs } = await import("../fixtures/auth");
      await loginAs(page, role);
      await page.goto(portal);
      await revealLeftRail(page);
      await page.getByTestId("left-panel-tab-messaging").click();
      const newBtn = page.getByTestId("messages-new-message");
      await expect(newBtn).toBeVisible();
      await newBtn.click();
      await expect(page.getByTestId("messages-compose-picker")).toBeVisible();
      // Scoped users are listed (roster excludes self, server-enforced).
      await expect(
        page.locator('[data-testid^="messages-compose-person-"]').first(),
      ).toBeVisible();
    });
  });
}
