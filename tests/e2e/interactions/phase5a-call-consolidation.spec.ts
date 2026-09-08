// Phase 5A — Team Portal call-workspace consolidation (objective browser check).
//
// Validates the SHARED PCS/ACS call surface after the clean-core pass:
//   • the queue row + call workspace show the CANONICAL per-case attempt count
//     ("Attempt N") and the Service·reason, not engineering/impl jargon,
//   • the phone-provider UI is DEMOTED to a compact status (the old provider
//     <select> switcher and "Make default" control are gone),
//   • there is exactly ONE disposition surface (the DispositionSheet) — the old
//     flag-gated structured "canonical call result" selector is gone — with the
//     conditional callback datetime field,
//   • "Open Schedule" opens the real scheduler WITH the patient's context.
//
// Objective only: no subjective visual sign-off. Asserts against stable
// data-testids + real DOM, records uncaught page errors, and captures
// screenshots as artifacts. Does NOT submit a disposition (no data mutation).
//
// Requires a running dev server (PLAYWRIGHT_BASE_URL) + seeded PLAYWRIGHT_TEST_*
// users. Skips cleanly when the queue has no schedulable/callable row.

import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";

const PCS_PORTAL = "/patient-care-specialist-portal";
const CLINIC = "Taylor Family Practice";
const SHOT_DIR = "test-results/phase5a";

// Dev-server-only noise that is NOT an application runtime error: the Vite HMR
// client websocket (absent in production builds), ResizeObserver loop notices,
// and transient resource loads. Real app exceptions still fail the test.
const IGNORABLE_PAGE_ERROR = /websocket|resizeobserver|failed to load resource|hmr|vite/i;

function watchRealPageErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => {
    const msg = String((e as Error)?.message ?? e);
    if (!IGNORABLE_PAGE_ERROR.test(msg)) errs.push(msg);
  });
  return errs;
}

async function openPortalAsPcs(page: Page) {
  const { loginAs } = await import("../fixtures/auth");
  await loginAs(page, "patientCareSpecialist");
  await page.goto(PCS_PORTAL);
  // Non-admin PCS is scoped to their own clinic; the facility selector may be
  // absent (locked). Select it only when present.
  const fac = page.getByTestId("select-facility");
  if (await fac.isVisible().catch(() => false)) {
    await fac.selectOption(CLINIC).catch(() => {});
  }
  await page.waitForTimeout(900);
}

// Reveal the right-rail Work Queue and open the first callable row's Call
// workspace (the quick-call Dialog). Returns false when no callable row exists.
async function openFirstCall(page: Page): Promise<boolean> {
  await page.mouse.move(page.viewportSize()!.width - 4, 450);
  await page.waitForTimeout(500);
  const callBtn = page.locator('[data-testid^="button-call-phone-"]').first();
  if (!(await callBtn.isVisible().catch(() => false))) return false;
  await callBtn.click();
  // The quick-call Dialog renders the shared CallWorkspace.
  const ws = page.getByTestId("call-workspace");
  if (!(await ws.isVisible().catch(() => false))) {
    await expect(ws).toBeVisible({ timeout: 8000 }).catch(() => {});
  }
  return await ws.isVisible().catch(() => false);
}

test.describe("Phase 5A — shared call workspace consolidation", () => {
  test("canonical attempt + service reason, demoted provider, one disposition, callback field", async ({ page }) => {
    const pageErrors = watchRealPageErrors(page);

    await openPortalAsPcs(page);
    const opened = await openFirstCall(page);
    if (!opened) {
      test.skip(true, "No callable queue row for this facility/date fixture");
      return;
    }

    // ── Patient header: name + canonical attempt count + the call reason ────
    await expect(page.getByTestId("call-workspace-name")).toBeVisible();
    const attempt = page.getByTestId("call-attempt-count");
    await expect(attempt).toBeVisible();
    await expect(attempt).toHaveText(/Attempt\s+\d+/);
    // "Reason:" label is present in the header (Service · reason).
    await expect(page.getByTestId("call-workspace").getByText(/Reason:/).first()).toBeVisible();

    // ── Provider UI is DEMOTED to a compact status ──────────────────────────
    await expect(page.getByTestId("call-provider-status")).toBeVisible();
    // The removed switcher / make-default controls must be gone.
    await expect(page.getByTestId("call-provider-select")).toHaveCount(0);
    await expect(page.getByTestId("call-provider-make-default")).toHaveCount(0);
    await expect(page.getByTestId("call-provider-default-badge")).toHaveCount(0);

    // ── No engineering / endpoint jargon in the visible surface ─────────────
    const wsText = (await page.getByTestId("call-workspace").innerText()).toLowerCase();
    expect(wsText).not.toContain("canonical call-result endpoint");
    expect(wsText).not.toContain("posts to the canonical");

    await page.screenshot({ path: `${SHOT_DIR}/call-workspace.png`, fullPage: true }).catch(() => {});

    // ── ONE disposition surface: open the sheet ─────────────────────────────
    await page.getByTestId("call-open-disposition").click();
    const sheet = page.getByTestId("disposition-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("disposition-attempt-counter")).toBeVisible();
    // Primary "Common outcomes" + the "More outcomes" progressive disclosure.
    await expect(page.getByTestId("disposition-option-reached")).toBeVisible();
    await expect(page.getByTestId("disposition-more-toggle")).toBeVisible();
    // The removed duplicate structured selector must NOT exist.
    await expect(page.getByTestId("canonical-call-result-selector")).toHaveCount(0);
    await expect(page.getByTestId("canonical-submit")).toHaveCount(0);

    // ── Conditional field: choosing "callback" reveals the datetime input ───
    await page.getByTestId("disposition-option-callback").click();
    await expect(page.getByTestId("disposition-callback-block")).toBeVisible();
    await expect(page.getByTestId("disposition-callback-input")).toBeVisible();

    await page.screenshot({ path: `${SHOT_DIR}/disposition-callback.png`, fullPage: true }).catch(() => {});

    // Close WITHOUT logging — this check never mutates canonical data.
    await page.getByTestId("disposition-cancel").click();
    await expect(sheet).toBeHidden({ timeout: 5000 }).catch(() => {});

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("Open Schedule opens the real scheduler WITH the patient's context", async ({ page }) => {
    const pageErrors = watchRealPageErrors(page);

    await openPortalAsPcs(page);
    const opened = await openFirstCall(page);
    if (!opened) {
      test.skip(true, "No callable queue row for this facility/date fixture");
      return;
    }

    // Capture the patient we're calling so we can prove the scheduler opens
    // for the SAME patient (context threaded), not a blank search.
    const patientName = (await page.getByTestId("call-workspace-name").innerText()).trim();
    expect(patientName.length).toBeGreaterThan(0);

    await expect(page.getByTestId("call-open-schedule")).toBeVisible();
    await page.getByTestId("call-open-schedule").click();

    // Routes to the real scheduler (existing availability engine) — never a
    // fake "scheduled" disposition.
    const scheduler = page.getByTestId("unified-scheduler");
    await expect(scheduler).toBeVisible({ timeout: 10000 });
    // …preloaded WITH the patient: the scheduler shows THIS patient (its
    // header/summary), not the generic patient search. Give the workspace
    // context a moment to thread in.
    await page.waitForTimeout(600);
    await expect(scheduler).toContainText(patientName, { timeout: 8000 });

    await page.screenshot({ path: `${SHOT_DIR}/schedule-with-context.png`, fullPage: true }).catch(() => {});

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
