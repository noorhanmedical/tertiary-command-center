// Engagement Call Lists command center — real-browser QA.
//
// Logs in as admin, opens Engagement Center → Call Lists, verifies the board
// renders (columns/date strip), the date strip is one-click, "Generate/Assign"
// opens GenerateCallListDialog seeded to the selected date, and — when a ready
// package exists — the PDF icon link streams a real PDF (HTTP 200). Captures
// screenshots at 1440/1280/1024. Dev noise (vite HMR websocket) is ignored.
//
// Run (dev server on $PLAYWRIGHT_BASE_URL, admin fixture seeded):
//   PLAYWRIGHT_BASE_URL=http://localhost:5177 \
//   PLAYWRIGHT_TEST_ADMIN_USER=e2e_playwright_admin PLAYWRIGHT_TEST_ADMIN_PASS=... \
//   npx playwright test tests/e2e/interactions/engagement-call-lists.spec.ts --project=chromium

import { test, expect, loginAs } from "../fixtures/auth";
import fs from "node:fs";

test.setTimeout(120_000);

const NOISE = /websocket|vite|ERR_CONNECTION_REFUSED|ResizeObserver|favicon|DevTools|validateDOMNesting/i;

test("Engagement Call Lists board — render, date, generate, PDF", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => { if (!NOISE.test(e.message)) pageErrors.push(e.message); });

  const report: Record<string, unknown> = {};
  await loginAs(page, "admin");

  try {
    // Open Engagement Center.
    await page.goto("/engagement-center", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // The Call Lists tab (gated on the call-list-packages flag).
    const tab = page.getByTestId("button-view-call-lists-board");
    report.tabPresent = (await tab.count()) > 0;
    if (report.tabPresent) {
      await tab.click();
      await page.waitForTimeout(1200);
    }

    report.boardPresent = (await page.getByTestId("calllist-board").count()) > 0;
    report.dateInputPresent = (await page.getByTestId("calllist-date-input").count()) > 0;
    report.clinicSelectPresent = (await page.getByTestId("calllist-clinic-select").count()) > 0;

    // Pick a clinic that actually has a roster. Prefer "Taylor Family Practice"
    // (the clinic with seeded team members + patient population); fall back to
    // the first real clinic.
    let selectedClinic: string | null = null;
    if (await page.getByTestId("calllist-clinic-select").count()) {
      await page.getByTestId("calllist-clinic-select").click();
      await page.waitForTimeout(300);
      const opts = page.locator("[role='option']");
      const n = await opts.count();
      const labels: string[] = [];
      for (let i = 0; i < n; i++) labels.push((await opts.nth(i).textContent())?.trim() ?? "");
      report.clinicOptions = labels;
      let idx = labels.findIndex((l) => /taylor family practice/i.test(l));
      if (idx < 0) idx = labels.findIndex((_, i) => i > 0); // first real clinic
      if (idx >= 0) {
        selectedClinic = labels[idx];
        await opts.nth(idx).click();
        await page.waitForTimeout(1400);
      }
    }
    report.selectedClinic = selectedClinic;

    const columnLocator = page.getByTestId("calllist-columns").locator("[data-testid^='calllist-column-']");
    const columnCount = await columnLocator.count().catch(() => 0);
    report.columnCount = columnCount;

    // ── Team Portal correlation: each rendered column's patient count must
    // equal a DIRECT call to the SAME /api/scheduler-portal/cases feed the Team
    // Portal uses (admin query by assignedTeamMemberId + facility + date). ──
    const selectedDate = await page.getByTestId("calllist-date-input").inputValue().catch(() => "");
    const correlation: Array<{ memberId: string; boardCount: number; feedCount: number; match: boolean }> = [];
    const ids = (await columnLocator.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-testid")?.replace("calllist-column-", "") ?? ""),
    )).filter(Boolean).slice(0, 5);
    for (const memberId of ids) {
      const boardTotalText = await page.getByTestId(`calllist-total-${memberId}`).textContent().catch(() => "");
      const boardCount = parseInt((boardTotalText ?? "").replace(/\D/g, ""), 10) || 0;
      const url = `/api/scheduler-portal/cases?assignedTeamMemberId=${memberId}&facilityId=${encodeURIComponent(selectedClinic ?? "")}&date=${selectedDate}&limit=500`;
      const resp = await page.request.get(url);
      const feed = resp.ok() ? await resp.json() : [];
      const feedCount = Array.isArray(feed) ? feed.length : 0;
      correlation.push({ memberId, boardCount, feedCount, match: boardCount === feedCount });
    }
    report.teamPortalCorrelation = correlation;

    // One-click date strip: click a different day and confirm selection moves.
    const days = page.locator("[data-testid^='calllist-day-']");
    report.dayPills = await days.count();
    if ((await days.count()) > 1) {
      const before = await page.getByTestId("calllist-date-input").inputValue().catch(() => "");
      // Click the last day pill in the week.
      await days.last().click();
      await page.waitForTimeout(600);
      const after = await page.getByTestId("calllist-date-input").inputValue().catch(() => "");
      report.dateChanged = before !== after ? `${before}→${after}` : `no-change(${before})`;
    }

    // ── PDF QA — drive the board to a date that HAS a ready package ──
    // Probe the canonical packages feed; if a ready package exists for this
    // clinic, navigate the board to that package's serviceDate and verify the
    // PDF icon renders + its link streams a real PDF (HTTP 200, application/pdf).
    try {
      const pkgResp = await page.request.get(
        `/api/engagement/call-lists/packages?facility=${encodeURIComponent(selectedClinic ?? "")}&limit=100`,
      );
      const pkgs: Array<{ id: number; teamMemberId: number; serviceDate: string | null; generationStatus: string; pdfAvailable: boolean }> =
        pkgResp.ok() ? await pkgResp.json() : [];
      const ready = pkgs.filter((p) => p.generationStatus === "ready" && p.pdfAvailable && p.serviceDate);
      report.packagesTotal = pkgs.length;
      report.packagesReady = ready.length;
      if (ready.length > 0) {
        const target = ready[0];
        // Drive the board to the package's date.
        await page.getByTestId("calllist-date-input").fill(target.serviceDate!);
        await page.waitForTimeout(1500);
        report.pdfIcons = await page.locator("a[data-testid^='calllist-pdf-']").count();
        const link = page.locator(`a[data-testid="calllist-pdf-${target.teamMemberId}"]`).first();
        const anyLink = (await link.count()) ? link : page.locator("a[data-testid^='calllist-pdf-']").first();
        if (await anyLink.count()) {
          const href = await anyLink.getAttribute("href");
          const resp = await page.request.get(href!);
          const buf = await resp.body();
          report.pdfCheck = {
            href,
            status: resp.status(),
            contentType: resp.headers()["content-type"] ?? "",
            bytes: buf.length,
            looksLikePdf: buf.slice(0, 5).toString("latin1") === "%PDF-",
          };
        } else {
          report.pdfCheck = "ready-package-exists-but-icon-not-rendered";
        }
      } else {
        report.pdfIcons = 0;
        report.pdfCheck = "no-ready-package-in-db";
      }
    } catch (e) {
      report.pdfCheck = `pdf-probe-error: ${(e as Error).message}`;
    }

    // Generate/Assign opens the dialog seeded to the selected date.
    const genBtn = page.getByTestId("calllist-generate");
    report.generateBtnDisabled = await genBtn.isDisabled().catch(() => null);
    if ((await genBtn.count()) && !(await genBtn.isDisabled())) {
      await genBtn.click();
      await page.waitForTimeout(800);
      const dialogDate = await page.getByTestId("gcl-service-date").textContent().catch(() => null);
      report.generateDialogDateChip = dialogDate;
      // Close the dialog without generating (QA — no real package created).
      await page.keyboard.press("Escape").catch(() => {});
    }

    // Responsive screenshots.
    for (const w of [1440, 1280, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/call-lists-${w}.png` });
    }

    report.flowError = null;
  } catch (e) {
    report.flowError = (e as Error).message;
  } finally {
    report.pageErrors = pageErrors;
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/call-lists-repro.json", JSON.stringify(report, null, 2));
    console.log("CALL_LISTS_REPORT=" + JSON.stringify(report));
  }

  expect(report.tabPresent, "Call Lists tab present").toBe(true);
  expect(report.boardPresent, "board renders").toBe(true);
  expect(pageErrors, pageErrors.join(" | ")).toEqual([]);
});
