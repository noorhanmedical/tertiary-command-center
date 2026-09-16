// P0 reproduction + calendar unification runtime QA (real browser).
//
// Logs in as admin, enumerates every calendar entry point in the shell, clicks
// each safe one, and records REAL app errors (dev HMR/websocket/ResizeObserver
// noise filtered out) + responsive screenshots. Honest browser reproduction —
// no code guessing.
//
// Run (dev server on $PLAYWRIGHT_BASE_URL, admin fixture seeded):
//   PLAYWRIGHT_BASE_URL=http://localhost:5057 \
//   PLAYWRIGHT_TEST_ADMIN_USER=e2e_playwright_admin \
//   PLAYWRIGHT_TEST_ADMIN_PASS=... \
//   npx playwright test tests/e2e/interactions/calendar-icon-repro.spec.ts --project=chromium

import { test, expect, loginAs } from "../fixtures/auth";
import fs from "node:fs";

test.setTimeout(120_000);

const NOISE =
  /websocket|vite|ERR_CONNECTION_REFUSED|ResizeObserver|favicon|Download the React DevTools|validateDOMNesting/i;

test("P0 — calendar entry-point reproduction + discovery", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (!NOISE.test(e.message)) pageErrors.push(e.message);
  });

  const go = async (path: string) => {
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    } catch {
      await page.waitForTimeout(500);
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    await page.waitForTimeout(1000);
  };

  await loginAs(page, "admin");
  await page.waitForTimeout(800);

  const domNestingWarnings: string[] = [];
  page.on("console", (m) => {
    if (/validateDOMNesting/.test(m.text())) domNestingWarnings.push(m.text().slice(0, 160));
  });

  async function discover(label: string) {
    const hits = await page.evaluate(() => {
      const out: Array<{ testid: string | null; aria: string | null; title: string | null; text: string }> = [];
      const nodes = Array.from(document.querySelectorAll("a,button,[role='button'],[data-testid]"));
      for (const el of nodes) {
        const testid = el.getAttribute("data-testid");
        const aria = el.getAttribute("aria-label");
        const title = el.getAttribute("title");
        const text = (el.textContent || "").trim().slice(0, 32);
        const hay = `${testid} ${aria} ${title} ${text}`.toLowerCase();
        if (/calendar|schedule/.test(hay)) out.push({ testid, aria, title, text });
      }
      return out;
    });
    return { label, url: new URL(page.url()).pathname, hits };
  }

  const report: Record<string, unknown> = {};
 try {
  // ── Home ──
  await go("/home");
  report.home = await discover("home");

  // ── GlobalNav "Global Schedule" (CalendarDays nav icon) ──
  const scheduleNav = page.getByLabel("Global Schedule");
  let scheduleNavResult = "not-found";
  if (await scheduleNav.count()) {
    await scheduleNav.first().click();
    try {
      await page.waitForURL(/\/schedule/, { timeout: 8000 });
      const titleVisible = await page.getByTestId("text-page-title").isVisible().catch(() => false);
      const calVisible = (await page.locator("[data-testid*='calendar'], table").count()) > 0;
      scheduleNavResult = `OK url=${new URL(page.url()).pathname} title=${titleVisible} calendarOrTable=${calVisible}`;
    } catch (e) {
      scheduleNavResult = `FAIL ${(e as Error).message}`;
    }
  }
  report.globalScheduleNav = scheduleNavResult;
  report.schedulePage = await discover("schedulePage");

  // ── Responsive screenshots of the Global Schedule calendar ──
  for (const w of [1440, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/calendar-schedule-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Plexus IQ: board + operating list calendar icon ──
  await go("/plexus-iq");
  report.plexusIqBoard = await discover("plexusIqBoard");
  // Enter the first clinic tile to reveal the operating-list toolbar (Calendar).
  const clinicTile = page.locator("[data-testid^='clinic-tile'], [data-testid^='iq-clinic']").first();
  if (await clinicTile.count()) {
    await clinicTile.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  report.plexusIqOperating = await discover("plexusIqOperating");
  const iqCal = page.getByRole("button", { name: /open calendar|^calendar$/i });
  let iqCalResult = "not-found";
  if (await iqCal.count()) {
    await iqCal.first().click().catch(() => {});
    await page.waitForTimeout(800);
    const drawer = (await page.getByRole("dialog").count()) > 0 || (await page.locator("[data-testid*='calendar']").count()) > 0;
    iqCalResult = `clicked drawerVisible=${drawer}`;
    await page.screenshot({ path: "test-results/calendar-plexus-iq.png" });
  }
  report.plexusIqCalendarIcon = iqCalResult;

  // ── P0 CORE: click the DOCK Calendar icon (dock-app-schedule) from multiple
  // contexts (§35) and confirm it lands on /schedule with the calendar shown ──
  const dockClicks: Array<{ from: string; landedUrl: string; calendarVisible: boolean; ok: boolean }> = [];
  for (const from of ["/home", "/engagement-center", "/patient-directory", "/plexus-iq", "/home"]) {
    await go(from);
    const dock = page.getByTestId("dock-app-schedule");
    if (!(await dock.count())) {
      dockClicks.push({ from, landedUrl: "(dock icon not found)", calendarVisible: false, ok: false });
      continue;
    }
    await dock.first().click({ force: true }).catch(() => {});
    let landed = "";
    let ok = false;
    try {
      await page.waitForURL(/\/schedule/, { timeout: 6000 });
      landed = new URL(page.url()).pathname;
      ok = true;
    } catch {
      landed = new URL(page.url()).pathname;
    }
    const calendarVisible = await page.getByTestId("canonical-month-calendar").isVisible().catch(() => false);
    dockClicks.push({ from, landedUrl: landed, calendarVisible, ok: ok && calendarVisible });
  }
  report.dockCalendarClicks = dockClicks;

  report.flowError = null;
 } catch (e) {
  report.flowError = (e as Error).message;
 } finally {
  report.domNestingWarnings = Array.from(new Set(domNestingWarnings));
  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/calendar-repro.json", JSON.stringify(report, null, 2));
  console.log("CALENDAR_REPRO=" + JSON.stringify(report));
 }

  // Fail only on REAL app crashes (uncaught page errors). Resource 401s from
  // unrelated auth-gated endpoints are logged in the report, not a calendar bug.
  expect(pageErrors, pageErrors.join(" | ")).toEqual([]);
});
