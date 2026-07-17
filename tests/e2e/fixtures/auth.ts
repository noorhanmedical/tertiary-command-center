// Authenticated fixtures for canonical E2E tests.
//
// Requires a running dev server (`npm run dev`) and seeded test users. In
// Replit / CI the following env vars can override the defaults:
//   PLAYWRIGHT_TEST_ADMIN_USER, PLAYWRIGHT_TEST_ADMIN_PASS
//   PLAYWRIGHT_TEST_CLINICIAN_USER, PLAYWRIGHT_TEST_CLINICIAN_PASS
//   PLAYWRIGHT_TEST_PCS_USER, PLAYWRIGHT_TEST_PCS_PASS
//   PLAYWRIGHT_TEST_ACS_USER, PLAYWRIGHT_TEST_ACS_PASS
//   PLAYWRIGHT_TEST_UNAUTH_USER, PLAYWRIGHT_TEST_UNAUTH_PASS
//
// No real user credentials are ever committed here. If the env vars are
// missing the tests skip with a clear message rather than fabricating a
// login.

import { test as base, expect, type Page } from "@playwright/test";

export type Role =
  | "admin"
  | "clinician"
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist"
  | "unauthorized";

const CREDENTIALS: Record<Role, { user: string | undefined; pass: string | undefined }> = {
  admin: {
    user: process.env.PLAYWRIGHT_TEST_ADMIN_USER,
    pass: process.env.PLAYWRIGHT_TEST_ADMIN_PASS,
  },
  clinician: {
    user: process.env.PLAYWRIGHT_TEST_CLINICIAN_USER,
    pass: process.env.PLAYWRIGHT_TEST_CLINICIAN_PASS,
  },
  patientCareSpecialist: {
    user: process.env.PLAYWRIGHT_TEST_PCS_USER,
    pass: process.env.PLAYWRIGHT_TEST_PCS_PASS,
  },
  ancillaryCareSpecialist: {
    user: process.env.PLAYWRIGHT_TEST_ACS_USER,
    pass: process.env.PLAYWRIGHT_TEST_ACS_PASS,
  },
  unauthorized: {
    user: process.env.PLAYWRIGHT_TEST_UNAUTH_USER,
    pass: process.env.PLAYWRIGHT_TEST_UNAUTH_PASS,
  },
};

/**
 * Logs the given role in and returns the authenticated page. The login POST
 * hits the same /api/auth/login the UI uses — no session tokens are minted
 * by tests. Skips if credentials aren't configured for this role.
 */
export async function loginAs(page: Page, role: Role): Promise<void> {
  const creds = CREDENTIALS[role];
  if (!creds.user || !creds.pass) {
    test.skip(true, `No PLAYWRIGHT_TEST_${role.toUpperCase()}_USER/PASS configured`);
    return;
  }
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(creds.user);
  await page.getByLabel(/password/i).fill(creds.pass);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((url) => !/login$/.test(url.pathname), { timeout: 10_000 });
}

/**
 * Extends Playwright's `test` fixture with a `role` param. Each spec picks
 * the role it needs; tests without a role stay unauthenticated.
 */
export const test = base.extend<{ role: Role | null }>({
  role: [null, { option: true }],
});

export { expect };
