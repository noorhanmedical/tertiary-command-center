// Scenario G — owner-scoped Playground/session isolation (browser E2E).
//
// The Playground persists open patient workspace tabs (PHI descriptors) to
// sessionStorage, which survives an SPA logout/login in the SAME browser tab.
// The restore path is FAIL-CLOSED: patient state is surfaced only on a positive
// owner match. This validates the real provider guard end-to-end:
//
//   • same user restores their OWN persisted patient tab after a reload;
//   • a DIFFERENT authenticated user in the same tab (session physically
//     surviving — the defensive path where the app's logout-clear did NOT run)
//     inherits NOTHING, and the foreign session is cleared. No PHI descriptor.
//
// The persisted session is seeded via sessionStorage in the exact shape the
// provider writes (owner-stamped), so the state-creation is deterministic while
// the code UNDER TEST is the real app restore guard + owner-scoped provider.
//
// Requires the dev server (PLAYWRIGHT_BASE_URL) + PLAYWRIGHT_TEST_PCS/ACS creds.

import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";

const PCS_PORTAL = "/patient-care-specialist-portal";
const STORAGE_KEY = "plexus_playground_session";
const PHI_NAME = "ScenarioG PHI Patient";
const SHOT_DIR = "test-results/scenariog";

async function meId(page: Page): Promise<string> {
  const res = await page.request.get("/api/auth/me");
  expect(res.status(), "auth/me should be 200 for a logged-in user").toBe(200);
  const body = await res.json();
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

// Seed a persisted session in the SAME shape saveSession() writes, stamped with
// `ownerUserId`, carrying one patient tab (PHI descriptor).
async function seedOwnedSession(page: Page, ownerUserId: string) {
  await page.evaluate(
    ({ key, owner, name }) => {
      const session = {
        ownerUserId: owner,
        workspaces: [
          {
            id: "ws_scenariog",
            type: "patient_ehr",
            title: name,
            patientId: null,
            patientScreeningId: 3,
            executionCaseId: null,
            ancillaryCaseId: null,
            serviceKey: null,
            facilityId: null,
            pinned: false,
            createdAt: Date.now(),
          },
        ],
        activeWorkspaceId: "ws_scenariog",
        savedAt: Date.now(),
      };
      sessionStorage.setItem(key, JSON.stringify(session));
    },
    { key: STORAGE_KEY, owner: ownerUserId, name: PHI_NAME },
  );
}

async function readPersistedOwner(page: Page): Promise<string | null | "MISSING"> {
  return page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return "MISSING";
    try { return (JSON.parse(raw).ownerUserId ?? null) as string | null; }
    catch { return "MISSING"; }
  }, STORAGE_KEY);
}

test.describe("Scenario G — owner-scoped session isolation", () => {
  test("same user restores their own patient tab after reload", async ({ page }) => {
    const { loginAs } = await import("../fixtures/auth");
    await loginAs(page, "patientCareSpecialist");
    await page.goto(PCS_PORTAL);
    const userA = await meId(page);

    // Seed user A's own persisted session, then reload as the SAME user.
    await seedOwnedSession(page, userA);
    await page.reload();

    // The provider restores user A's own tab once auth resolves (deferred
    // restore) — the PHI descriptor becomes visible in the tab strip.
    await expect(page.getByText(PHI_NAME).first()).toBeVisible({ timeout: 12000 });
    await page.screenshot({ path: `${SHOT_DIR}/same-user-restored.png` }).catch(() => {});
  });

  test("a different user in the same tab inherits no patient state (fail closed + cleared)", async ({ page }) => {
    const { loginAs } = await import("../fixtures/auth");
    // Worker A logs in and establishes a persisted patient session.
    await loginAs(page, "patientCareSpecialist");
    await page.goto(PCS_PORTAL);
    const userA = await meId(page);
    await seedOwnedSession(page, userA);
    expect(await readPersistedOwner(page)).toBe(userA);

    // Worker B authenticates in the SAME browser tab WITHOUT the app's
    // logout-clear running (defensive path: token swap / expiry / crash). The
    // API login replaces the session cookie; A's sessionStorage survives.
    const pcsUser = process.env.PLAYWRIGHT_TEST_ACS_USER;
    const pcsPass = process.env.PLAYWRIGHT_TEST_ACS_PASS;
    test.skip(!pcsUser || !pcsPass, "No ACS creds configured for the second user");
    const loginRes = await page.request.post("/api/auth/login", {
      data: { username: pcsUser, password: pcsPass },
    });
    expect(loginRes.status(), "second user login should succeed").toBe(200);
    const userB = await meId(page);
    expect(userB, "second user must be a different identity").not.toBe(userA);

    // Boot the SPA as user B with A's persisted session still physically present.
    await page.goto(PCS_PORTAL);
    // Wait until the portal shell has mounted as user B.
    await expect(page.locator('[data-team-portal-shell="true"]')).toBeVisible({ timeout: 15000 });
    // Allow auth resolution + the owner-scoped restore guard to run.
    await page.waitForTimeout(1500);

    // No PHI descriptor from user A is present anywhere.
    await expect(page.getByText(PHI_NAME)).toHaveCount(0);
    // No playground tab carries A's patient.
    const tabWithPhi = page.locator('[data-testid^="playground-tab-"]', { hasText: PHI_NAME });
    await expect(tabWithPhi).toHaveCount(0);

    // The fail-closed guard cleared A's foreign session. B's provider may have
    // then persisted ITS OWN (empty) session — that is fine. The invariant is
    // that A's PHI / owner id is never present in persisted storage for B.
    const persisted = (await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)) ?? "";
    expect(persisted, "A's PHI descriptor must not survive into B's storage").not.toContain(PHI_NAME);
    expect(persisted, "A's owner id must not survive into B's storage").not.toContain(userA);
    expect(await readPersistedOwner(page), "any surviving session belongs to B, never A").not.toBe(userA);

    await page.screenshot({ path: `${SHOT_DIR}/cross-user-isolated.png` }).catch(() => {});
  });
});
