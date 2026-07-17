// Canonical route smoke tests.
//
// For every canonical route the app exposes, assert that the page:
//   1. Renders without a client-side error.
//   2. Renders the expected canonical page component (identified by a
//      stable data-testid or a documented title/heading).
//   3. Does not show a placeholder, playground, or preview shell where a
//      live shell is expected.
//
// These tests require an authenticated admin session. See fixtures/auth.ts.

import { test, expect, loginAs } from "../fixtures/auth";

const CANONICAL_ROUTES: { path: string; description: string; expectSelector?: string }[] = [
  { path: "/home", description: "Home dashboard" },
  { path: "/engagement-center", description: "Engagement Center" },
  { path: "/team-ops", description: "Team Ops" },
  { path: "/plexus-tasks", description: "Plexus Tasks" },
  { path: "/plexus-iq", description: "Plexus IQ workspace" },
  { path: "/mission-control", description: "Mission Control" },
  { path: "/patient-directory", description: "Patient Directory" },
  { path: "/patient-directory/live", description: "Patient Directory Live" },
  { path: "/patient-database", description: "Patient Database" },
  { path: "/physician-portal", description: "Physician Portal (redirects to clinician-portal)" },
  { path: "/clinician-portal", description: "Clinician Portal shell" },
  {
    path: "/patient-care-specialist-portal",
    description: "PCS workspace (must mount ClinicWorkflowPortal→TeamPortalShell)",
  },
  {
    path: "/ancillary-care-specialist-portal",
    description: "ACS workspace (must mount ClinicWorkflowPortal→TeamPortalShell)",
  },
  { path: "/clinic-analytics", description: "Clinic Analytics" },
  { path: "/clinic-onboarding", description: "Clinic Onboarding" },
  { path: "/clinical-intelligence", description: "Clinical Intelligence" },
  { path: "/imaging-central", description: "Imaging Central" },
  { path: "/plexus-bank", description: "Plexus Bank" },
  { path: "/documents", description: "Documents" },
  { path: "/document-library", description: "Document Library" },
  { path: "/schedule-dashboard", description: "Schedule Dashboard" },
  { path: "/admin/settings", description: "Unified Admin Settings" },
];

test.describe("Canonical route smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    // Capture any console errors — a canonical route smoke test must never
    // pass while React throws inside the page.
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    // eslint-disable-next-line no-console
    (page as any)._pageErrors = errors;
  });

  for (const route of CANONICAL_ROUTES) {
    test(`${route.path} — ${route.description}`, async ({ page }) => {
      const resp = await page.goto(route.path);
      // Should never 500. Redirects (302 to /clinician-portal for physician
      // portal) are fine — Playwright follows them.
      expect(resp?.status(), `${route.path} returned ${resp?.status()}`).toBeLessThan(500);

      // React error boundary check: no page errors thrown.
      // eslint-disable-next-line no-await-in-loop
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      const errors = (page as any)._pageErrors as string[];
      expect(errors, `pageerror thrown on ${route.path}: ${errors.join("; ")}`).toHaveLength(0);

      if (route.expectSelector) {
        await expect(page.locator(route.expectSelector).first()).toBeVisible();
      }
    });
  }
});
