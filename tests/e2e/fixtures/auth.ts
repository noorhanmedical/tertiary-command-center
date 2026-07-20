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
  // Stable test IDs from client/src/pages/login.tsx.
  // Prefer testId over role/label queries — label queries have broken
  // in the past when a label element wraps the input differently.
  await page.getByTestId("input-login-username").fill(creds.user);
  await page.getByTestId("input-login-password").fill(creds.pass);
  await page.getByTestId("button-login-submit").click();

  // API-level authentication gate: poll /api/auth/me via the browser
  // context (page.request shares the page's cookies, so the session
  // set by /api/auth/login flows through here). We wait until the
  // server confirms the session — this is the correct global auth
  // signal, independent of any specific page's DOM. A page-specific
  // DOM anchor (e.g. the top banner) would drift if any authenticated
  // route ever changed its layout.
  const AUTH_ME_TIMEOUT_MS = 15_000;
  const AUTH_ME_POLL_MS = 200;
  const authDeadline = Date.now() + AUTH_ME_TIMEOUT_MS;
  let authenticated = false;
  while (Date.now() < authDeadline) {
    const res = await page.request.get("/api/auth/me");
    if (res.status() === 200) {
      authenticated = true;
      break;
    }
    // Any status other than 200 means the session hasn't been
    // established yet — /api/auth/login may still be in flight or
    // the response body may not have hit the cookie store. Retry.
    await page.waitForTimeout(AUTH_ME_POLL_MS);
  }
  if (!authenticated) {
    throw new Error(
      `loginAs(${role}): /api/auth/me never returned 200 within ${AUTH_ME_TIMEOUT_MS}ms`,
    );
  }

  // Only after the session is confirmed do we wait for the URL to
  // leave /login. This ordering prevents any race between the client
  // router's post-login navigate() and the caller's next page.goto.
  await page.waitForURL((url) => !/login$/.test(url.pathname), {
    timeout: 10_000,
  });
}

/**
 * Extends Playwright's `test` fixture with a `role` param. Each spec picks
 * the role it needs; tests without a role stay unauthenticated.
 */
export const test = base.extend<{ role: Role | null }>({
  role: [null, { option: true }],
});

export { expect };
