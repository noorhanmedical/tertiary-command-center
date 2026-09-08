// Phase 5B — persistent claimed patient interaction across Phone ↔ Calendar,
// with owner-scoped drafts, stale-work recovery, Save & Next, and two-session
// concurrency. Exercises the REAL claim endpoints + disposition guard + the
// client claim hook / draft persistence end-to-end.
//
// Staging uses raw pg (no path aliases) to reset the seeded roster-5 case
// between tests and to simulate a takeover for the stale-work test. Requires:
//   PLAYWRIGHT_BASE_URL, PLAYWRIGHT_TEST_PCS_USER/PASS, PLAYWRIGHT_TEST_ACS_USER/PASS,
//   DATABASE_URL, and a seeded "__P5BE2E__ Callable" case (assigned to roster 5).

import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import pg from "pg";

const PCS_PORTAL = "/patient-care-specialist-portal";
const MARKER = "__P5BE2E__";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function resetSeededCase(): Promise<{ caseId: number; screeningId: number }> {
  const { rows } = await pool.query(
    `SELECT id, patient_screening_id FROM patient_execution_cases WHERE patient_name LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`${MARKER}%`],
  );
  if (!rows.length) throw new Error("seeded __P5BE2E__ case not found — run the seed helper first");
  const caseId = Number(rows[0].id);
  const screeningId = Number(rows[0].patient_screening_id);
  await pool.query(
    `UPDATE patient_execution_cases
        SET active_claim_by=NULL, active_claim_at=NULL, active_claim_expires_at=NULL,
            engagement_status='not_reached', lifecycle_status='active', next_action_at=now(),
            call_attempt_count=1
      WHERE id=$1`,
    [caseId],
  );
  await pool.query(`DELETE FROM outreach_calls WHERE patient_screening_id=$1`, [screeningId]);
  return { caseId, screeningId };
}

async function takeoverByRoster6(caseId: number) {
  // active_claim_at / active_claim_expires_at are `timestamp without time zone`
  // columns that the SERVER writes/reads as UTC wall-clock (it binds JS Dates).
  // A bare psql now() would store the DB session-local wall-clock instead
  // (this DB session is America/Phoenix, UTC-7), which the server then reads
  // back as a claim that expired hours ago — so its stale-work guard would see
  // "no active claim" and wrongly allow the disposition. Normalizing to UTC
  // (now() AT TIME ZONE 'UTC') makes the takeover a genuinely LIVE claim held
  // by another member, which is exactly what the guard must reject (409).
  await pool.query(
    `UPDATE patient_execution_cases
        SET active_claim_by=6,
            active_claim_at=(now() AT TIME ZONE 'UTC'),
            active_claim_expires_at=(now() AT TIME ZONE 'UTC') + interval '5 minutes'
      WHERE id=$1`,
    [caseId],
  );
}

async function openPortalAsPcs(page: Page) {
  const { loginAs } = await import("../fixtures/auth");
  await loginAs(page, "patientCareSpecialist");
  await page.goto(PCS_PORTAL);
  await page.waitForTimeout(800);
}

async function openSeededCall(page: Page, caseId: number) {
  await page.mouse.move(page.viewportSize()!.width - 4, 450);
  await page.waitForTimeout(500);
  const btn = page.getByTestId(`button-call-phone-${caseId}`);
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click();
  await expect(page.getByTestId("call-workspace")).toBeVisible({ timeout: 8000 });
}

async function claimHeldByRoster5(page: Page, caseId: number): Promise<boolean> {
  const res = await page.request.get(`/api/engagement/work-claims/${caseId}`);
  if (!res.ok()) return false;
  const b = await res.json();
  return b?.claim?.active === true && b?.claim?.claimedBySchedulerId === 5;
}

test.describe("Phase 5B — persistent claimed call interaction", () => {
  let caseId = 0;
  let screeningId = 0;

  test.beforeEach(async () => {
    const s = await resetSeededCase();
    caseId = s.caseId;
    screeningId = s.screeningId;
  });
  test.afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test("claim acquired on call; note draft persists across close/reopen and Phone→Calendar keeps the claim + context", async ({ page }) => {
    await openPortalAsPcs(page);
    await openSeededCall(page, caseId);

    // Claim acquired server-side, held by the PCS scheduler (roster 5).
    await expect
      .poll(() => claimHeldByRoster5(page, caseId), { timeout: 8000 })
      .toBe(true);

    // Draft survives close + reopen of the disposition sheet.
    await page.getByTestId("call-open-disposition").click();
    await expect(page.getByTestId("disposition-sheet")).toBeVisible();
    const NOTE = `5B draft ${Date.now()}`;
    await page.getByTestId("disposition-notes").fill(NOTE);
    await page.getByTestId("disposition-cancel").click();
    await expect(page.getByTestId("disposition-sheet")).toBeHidden();
    await page.getByTestId("call-open-disposition").click();
    await expect(page.getByTestId("disposition-notes")).toHaveValue(NOTE);
    await page.getByTestId("disposition-cancel").click();

    // Phone→Calendar: opens the real scheduler WITH the same patient context…
    await page.getByTestId("call-open-schedule").click();
    await expect(page.getByTestId("unified-scheduler")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(600);
    await expect(page.getByTestId("unified-scheduler")).toContainText(MARKER);
    // …and the claim PERSISTS across the mode switch (still held by roster 5).
    await expect
      .poll(() => claimHeldByRoster5(page, caseId), { timeout: 8000 })
      .toBe(true);
  });

  test("disposition releases the claim, clears the draft, and Save & Next transitions the workspace", async ({ page }) => {
    await openPortalAsPcs(page);
    await openSeededCall(page, caseId);
    await expect.poll(() => claimHeldByRoster5(page, caseId), { timeout: 8000 }).toBe(true);

    await page.getByTestId("call-open-disposition").click();
    const NOTE = `5B dispo ${Date.now()}`;
    await page.getByTestId("disposition-notes").fill(NOTE);
    // draft is persisted for this owner + case
    const me = await (await page.request.get("/api/auth/me")).json();
    const draftKey = `plexus_call_draft:${me.id}:${caseId}`;
    await expect
      .poll(async () => page.evaluate((k) => sessionStorage.getItem(k), draftKey))
      .not.toBeNull();

    await page.getByTestId("disposition-option-reached").click();
    await page.getByTestId("disposition-submit").click();

    // Holder disposition → server auto-releases the claim in the same tx.
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/engagement/work-claims/${caseId}`);
        if (!res.ok()) return true;
        const b = await res.json();
        return !b?.claim || b.claim.active === false;
      }, { timeout: 8000 })
      .toBe(true);

    // Draft cleared on durable completion.
    expect(await page.evaluate((k) => sessionStorage.getItem(k), draftKey)).toBeNull();

    // Save & Next: no more callable rows for this fixture → the call workspace
    // transitions closed (back to the queue), never a fake lingering state.
    await expect(page.getByTestId("call-workspace")).toBeHidden({ timeout: 8000 });
  });

  test("stale-work: a takeover makes the disposition rejected; the draft is preserved and no attempt is written", async ({ page }) => {
    await openPortalAsPcs(page);
    await openSeededCall(page, caseId);
    await expect.poll(() => claimHeldByRoster5(page, caseId), { timeout: 8000 }).toBe(true);

    await page.getByTestId("call-open-disposition").click();
    const NOTE = `5B stale ${Date.now()}`;
    await page.getByTestId("disposition-notes").fill(NOTE);
    await page.getByTestId("disposition-option-reached").click();

    // Another team member takes over the patient's active work mid-interaction.
    await takeoverByRoster6(caseId);

    const respPromise = page.waitForResponse(
      (r) => r.url().includes("/api/engagement-center/call-result"),
      { timeout: 10000 },
    );
    await page.getByTestId("disposition-submit").click();
    const resp = await respPromise;
    // Server MUST reject the stale submitter.
    expect(resp.status(), "stale submitter must be rejected 409").toBe(409);

    // Calm recovery: stale banner, the typed note is PRESERVED, no fake success.
    await expect(page.getByTestId("disposition-stale-claim")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("disposition-notes")).toHaveValue(NOTE);
    // Server rolled back — no outreach_call attempt was written.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM outreach_calls WHERE patient_screening_id=$1`,
      [screeningId],
    );
    expect(rows[0].n).toBe(0);
    // Safe actions available.
    await expect(page.getByTestId("disposition-stale-return")).toBeVisible();
  });

  test("concurrency: while PCS holds the claim, a second user's disposition is rejected and PCS's claim is undisturbed", async ({ page, browser }) => {
    await openPortalAsPcs(page);
    await openSeededCall(page, caseId);
    await expect.poll(() => claimHeldByRoster5(page, caseId), { timeout: 8000 }).toBe(true);

    // A DIFFERENT authenticated user (ACS) in a separate browser context tries
    // to disposition the SAME patient concurrently.
    const ctxB = await browser.newContext();
    try {
      const pageB = await ctxB.newPage();
      const loginB = await pageB.request.post("/api/auth/login", {
        data: {
          username: process.env.PLAYWRIGHT_TEST_ACS_USER,
          password: process.env.PLAYWRIGHT_TEST_ACS_PASS,
        },
      });
      expect(loginB.status()).toBe(200);
      const dispo = await pageB.request.post("/api/engagement-center/call-result", {
        data: { patientScreeningId: screeningId, callResult: "reached", note: "B concurrent" },
      });
      expect(dispo.status(), "second user's concurrent disposition must be rejected").toBe(409);
      const body = await dispo.json();
      expect(body.code).toBe("stale_work_claim");
    } finally {
      await ctxB.close();
    }

    // PCS's active claim is undisturbed by the rejected concurrent attempt.
    expect(await claimHeldByRoster5(page, caseId)).toBe(true);
  });
});
