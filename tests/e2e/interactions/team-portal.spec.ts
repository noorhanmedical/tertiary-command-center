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
      //   1. Switch left rail to Tools; open the Settings dialog via
      //      the `left-rail-tool-settings` tool.
      //   2. Change the default tray tab in the WorkspaceSettingsDialog.
      //   3. Close the dialog — `flushPersist` on the dialog's
      //      onOpenChange awaits the PUT.
      //   4. Reload. The default tray tab must reflect the newly
      //      persisted value: after opening Tools again, the tray body
      //      that renders in the Tools rail must match the picked tab.
      //
      // The `leftPanelTab` state is intentionally NOT persisted
      // (session-scoped ephemeral state), so re-opening Tools after
      // reload is required to surface the tray body. `defaultTrayTab`
      // IS persisted — verified via the tray-body assertion below.
      await openToolsTab(page);
      const settingsBtn = page.getByTestId("left-rail-tool-settings");
      await expect(settingsBtn).toBeVisible();
      await settingsBtn.click();

      const dialog = page.getByTestId("workspace-settings-dialog");
      await expect(dialog).toBeVisible();

      const traySelect = dialog.getByTestId("setting-default-tray-tab");
      await expect(traySelect).toBeVisible();

      // Read the current select value and pick a DIFFERENT option so
      // the reload is guaranteed to observe a change. `Patient Messages`
      // (patients) is the target unless the current default is already
      // patients — in which case we pick `Team Chat` instead.
      const currentTab = await traySelect.textContent();
      const nextTab =
        currentTab && /patient/i.test(currentTab)
          ? { label: "Team Chat", body: "tray-team" }
          : { label: "Patient Messages", body: "tray-patients" };

      await traySelect.click();
      await page.getByRole("option", { name: nextTab.label }).click();

      // Wait for the persistence PUT to hit the server AND return
      // 200 BEFORE closing the dialog or reloading. This is the
      // definitive server-side commit signal — if this never fires,
      // the assertion below would race a still-in-flight write.
      const persistDone = page.waitForResponse(
        (res) =>
          res.request().method() === "PUT" &&
          /\/api\/portal\/workspace-prefs$/.test(res.url()) &&
          res.status() === 200,
        { timeout: 10_000 },
      );

      // Closing the dialog triggers `flushPersist` (see
      // WorkspaceSettingsDialog.tsx `handleOpenChange`), which
      // awaits the debounced write. The dialog only unmounts AFTER
      // that promise resolves.
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
      // body inside the Tools rail. If the persisted defaultTrayTab
      // matches nextTab, that body renders.
      await openToolsTab(page);
      await expect(
        page.getByTestId("portal-left-rail").getByTestId(nextTab.body),
      ).toBeVisible();
    });
  });
}
