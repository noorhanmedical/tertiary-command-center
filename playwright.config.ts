// Playwright configuration — Phase 1 E2E foundation.
//
// The dev server (`npm run dev`) must be running on http://localhost:5000
// with the seeded test-user fixtures loaded before running these tests.
// Auth fixtures live under tests/e2e/fixtures/.
//
// This config intentionally boots against a single Chromium browser to keep
// CI runtime bounded. Add firefox / webkit projects only when a cross-
// browser failure is observed on a canonical route.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/playwright-report.json" }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    testIdAttribute: "data-testid",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
  outputDir: "test-results/",
});
