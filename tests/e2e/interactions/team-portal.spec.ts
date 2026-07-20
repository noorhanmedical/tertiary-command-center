// Team Portal (ACS + PCS) interaction tests.
//
// Both live routes MUST mount ClinicWorkflowPortal → TeamPortalShell.
//
// Test IDs used (all confirmed to exist in the current source):
//   • data-team-portal-shell="true"    — TeamPortalShell root
//                                        (Phase 3 v3 instrumentation)
//   • data-testid={`portal-${role}`}   — role-tagged shell root
//   • data-testid="portal-left-rail"   — left rail container
//   • data-testid="button-pin-left-rail" — left-rail pin/unpin toggle
//   • data-testid="left-panel-tab-messaging" — left rail Messaging tab
//   • data-testid="left-panel-tab-tools"     — left rail Tools tab
//   • data-testid="left-rail-tools-rail" — the Tools tab body
//   • data-testid="tool-dock"          — ToolDock container (renders
//                                        inside the Tools tab body)
//   • data-testid="left-rail-tool-settings" — opens
//                                        WorkspaceSettingsDialog
//   • data-testid="workspace-settings-dialog" — settings dialog root
//   • data-testid="setting-default-tray-tab"  — Radix Select for the
//                                        default tray tab
//   • data-testid="tray-patients" / "tray-direct" / "tray-team" —
//                                        the tray tab bodies
//
// The Playground/Prototype safety check remains: portal-playground-*
// IDs must not appear on the live routes.
//
// Requires a running dev server and the seeded PCS + ACS test users
// (see script/seedE2EPlaywrightUsers.ts).

import { test, expect, loginAs } from "../fixtures/auth";

async function openToolsTab(page: import("@playwright/test").Page) {
  // Step 1 — reveal the left rail via the pin button. On a fresh
  // portal load the rail's inner panel is translated ~82% off-screen
  // with 50% opacity (TeamPortalShell.tsx:2849-2853), and only
  // hover-peek OR the pin button brings it fully visible. The pin
  // button is the deterministic path.
  const pinBtn = page.getByTestId("button-pin-left-rail");
  await expect(pinBtn).toBeVisible();
  await pinBtn.click();

  // Step 2 — verify the rail is actually pinned/revealed. The pin
  // button's aria-label flips from "Pin panel" to "Unpin panel"
  // when `leftRailPinned` becomes true (TeamPortalShell.tsx:2899).
  // Using this attribute — instead of the always-in-DOM
  // `portal-left-rail` container — gives us a real "revealed" gate.
  await expect(pinBtn).toHaveAttribute("aria-label", "Unpin panel");
  await expect(page.getByTestId("portal-left-rail")).toBeVisible();

  // Step 3 — the rail now shows both left-panel tabs. Click the
  // Tools tab (the rail defaults to Messaging) and assert the Tools
  // body renders. No force:true — the pinned rail makes the tab a
  // normal interactable element via the real user interaction path.
  await page.getByTestId("left-panel-tab-tools").click();
  await expect(page.getByTestId("left-rail-tools-rail")).toBeVisible();
}

for (const { role, path, label } of [
  { role: "patientCareSpecialist" as const, path: "/patient-care-specialist-portal", label: "PCS" },
  { role: "ancillaryCareSpecialist" as const, path: "/ancillary-care-specialist-portal", label: "ACS" },
]) {
  test.describe(`${label} — ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, role);
      await page.goto(path);
    });

    test("mounts TeamPortalShell (not Playground)", async ({ page }) => {
      // Shell root marker — a single locator covers both PCS and ACS.
      await expect(page.locator('[data-team-portal-shell="true"]')).toBeVisible();
      // Live routes must not mount the Playground / prototype variants.
      await expect(page.getByTestId(/portal-playground-/)).toHaveCount(0);
    });

    test("left rail is visible and the pin button works", async ({ page }) => {
      const rail = page.getByTestId("portal-left-rail");
      await expect(rail).toBeVisible();
      // Pin button must exist and the two clicks must succeed. Not a
      // presence-only check.
      const pinBtn = page.getByTestId("button-pin-left-rail");
      await expect(pinBtn).toBeVisible();
      await pinBtn.click();
      await pinBtn.click();
    });

    test("tool dock is present after switching to the Tools tab", async ({
      page,
    }) => {
      // Left rail defaults to Messaging; Tools tab must be activated
      // before tool-dock can be asserted.
      await openToolsTab(page);
      // The ToolDock component renders `data-testid="tool-dock"` inside
      // the Tools tab body. Scope to `portal-left-rail` so a future
      // right-rail tool dock (if any) can't accidentally satisfy this.
      const rail = page.getByTestId("portal-left-rail");
      await expect(rail.getByTestId("tool-dock").first()).toBeVisible();
    });

    test("workspace-prefs default tray tab persists after refresh", async ({
      page,
    }) => {
      // Real end-to-end persistence path:
      //   1. Reveal the left rail and switch to Tools.
      //   2. Open the Settings dialog via `left-rail-tool-settings`.
      //   3. Toggle Default tray tab between Direct Messages and
      //      Team Chat (the only two supported values — Patient
      //      Messages is not exposed on this platform).
      //   4. Close the dialog. `flushPersist` on the dialog's
      //      onOpenChange awaits the PUT; the test additionally waits
      //      for the 200 network response.
      //   5. Reload. Re-open Tools rail (leftPanelTab is session
      //      state, intentionally not persisted).
      //   6. Assert the persisted value drove BOTH:
      //        a) the tray-tab button's aria-selected attribute
      //           (stable, non-visual state marker)
      //        b) the corresponding tray body's visibility (which
      //           requires the Tools rail to have real flex area).
      await openToolsTab(page);
      const settingsBtn = page.getByTestId("left-rail-tool-settings");
      await expect(settingsBtn).toBeVisible();
      await settingsBtn.click();

      const dialog = page.getByTestId("workspace-settings-dialog");
      await expect(dialog).toBeVisible();

      const traySelect = dialog.getByTestId("setting-default-tray-tab");
      await expect(traySelect).toBeVisible();

      // Read the current select value and pick the OPPOSITE option so
      // the reload is guaranteed to observe a change. Only two options
      // exist: Direct Messages ↔ Team Chat.
      const currentTab = await traySelect.textContent();
      const nextTab =
        currentTab && /team/i.test(currentTab)
          ? { label: "Direct Messages", value: "direct", body: "tray-direct" }
          : { label: "Team Chat", value: "team", body: "tray-team" };

      await traySelect.click();
      await page.getByRole("option", { name: nextTab.label }).click();

      // Wait for the persistence PUT to hit the server AND return
      // 200 BEFORE closing the dialog or reloading. This is the
      // definitive server-side commit signal.
      const persistDone = page.waitForResponse(
        (res) =>
          res.request().method() === "PUT" &&
          /\/api\/portal\/workspace-prefs$/.test(res.url()) &&
          res.status() === 200,
        { timeout: 10_000 },
      );

      // Closing the dialog triggers `flushPersist`; the dialog only
      // unmounts after the PUT resolves.
      await page.keyboard.press("Escape");
      await persistDone;
      await expect(dialog).toHaveCount(0);

      // Reload. On mount, TeamPortalShell reads the persisted
      // defaultTrayTab from /api/portal/workspace-prefs and seeds
      // trayTab from it.
      await page.reload();
      await expect(
        page.locator('[data-team-portal-shell="true"]'),
      ).toBeVisible();

      // Re-open Tools — the docked layout only surfaces the tray
      // inside the Tools rail.
      await openToolsTab(page);

      const rail = page.getByTestId("portal-left-rail");
      // The tray container is always mounted inside the Tools rail
      // now that the rail's dock/calendar block cannot consume all
      // vertical space (see TeamPortalShell.tsx layout contract).
      await expect(rail.getByTestId("communication-tray")).toBeVisible();

      // Non-visual state marker: the tray-tab button's aria-selected
      // attribute reflects the active tab regardless of layout, so
      // the assertion holds even if the tray body has zero animation
      // frames in.
      const trayTabButton = rail.getByTestId(`tray-tab-${nextTab.value}`);
      await expect(trayTabButton).toHaveAttribute("aria-selected", "true");

      // And the body itself must be in the DOM and visible — this
      // is the layout-fix gate: if the tray's flex area were 0 the
      // body's bounding box would be 0×0 and `toBeVisible` would
      // fail.
      await expect(rail.getByTestId(nextTab.body)).toBeVisible();
    });
  });
}
