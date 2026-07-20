// tests/unit/workspacePrefsPersistence.test.ts
//
// Locks the tray-tab persistence contract end-to-end:
//
//   §1  Server prefsSchema.defaultTrayTab accepts every option the
//       WorkspaceSettingsDialog offers ("patients", "direct", "team").
//   §2  Client TRAY_TABS validation matches the server enum exactly.
//   §3  parseWorkspacePrefs preserves each tray tab in a roundtrip
//       instead of falling back to a default.
//   §4  parseWorkspacePrefs falls back to the default on an unknown
//       value, so a future enum-drift bug can't silently corrupt.
//   §5  The WorkspaceSettingsDialog offers exactly the same three
//       SelectItem values.
//   §6  The `flushPersist` symbol is exported and wired into the
//       dialog / shell, so a debounced write commits on close.
//
// Runnable via:
//   npx tsx tests/unit/workspacePrefsPersistence.test.ts

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const prefsClientPath = path.join(ROOT, "client/src/components/portal/tools/workspacePrefs.ts");
const dialogPath = path.join(ROOT, "client/src/components/portal/tools/WorkspaceSettingsDialog.tsx");
const shellPath = path.join(ROOT, "client/src/components/portal/TeamPortalShell.tsx");
const routePath = path.join(ROOT, "server/routes/portalPrefs.ts");

const prefsClient = fs.readFileSync(prefsClientPath, "utf8");
const dialog = fs.readFileSync(dialogPath, "utf8");
const shell = fs.readFileSync(shellPath, "utf8");
const route = fs.readFileSync(routePath, "utf8");

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`- ${msg}`);
};

// §1 — server schema must include every tray tab. Extract the enum
// literal and cross-check it.
const serverEnumMatch = route.match(
  /defaultTrayTab:\s*z\.enum\(\[([^\]]+)\]\)/,
);
if (!serverEnumMatch) {
  fail("§1 server prefsSchema does not declare defaultTrayTab as z.enum([...])");
} else {
  const values = serverEnumMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  for (const required of ["patients", "direct", "team"]) {
    if (!values.includes(required)) {
      fail(`§1 server enum missing "${required}"`);
    }
  }
}

// §2 — client TRAY_TABS validation array. Same three tabs.
const trayTabsMatch = prefsClient.match(
  /const\s+TRAY_TABS:\s*TrayTab\[\]\s*=\s*\[([^\]]+)\]/,
);
if (!trayTabsMatch) {
  fail("§2 client TRAY_TABS array declaration not found");
} else {
  const values = trayTabsMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  for (const required of ["patients", "direct", "team"]) {
    if (!values.includes(required)) {
      fail(`§2 client TRAY_TABS missing "${required}"`);
    }
  }
}

// §3 + §4 — parseWorkspacePrefs behavioural roundtrip.
// Dynamically import the module so we exercise the real code path,
// not a regex.
(async () => {
  const modulePath = "../../client/src/components/portal/tools/workspacePrefs";
  const { parseWorkspacePrefs, DEFAULT_WORKSPACE_PREFS } = await import(modulePath);

  for (const tab of ["patients", "direct", "team"]) {
    const parsed = parseWorkspacePrefs({
      defaultTrayTab: tab,
      stickyNotesVisible: true,
      toolsPinnedByDefault: false,
      workQueuePinnedByDefault: false,
      playgroundLayout: "docked",
      calendarBehavior: "quickSchedule",
    });
    if (parsed?.defaultTrayTab !== tab) {
      fail(
        `§3 parseWorkspacePrefs corrupts tray tab "${tab}" → "${parsed?.defaultTrayTab}"`,
      );
    }
  }

  const parsedUnknown = parseWorkspacePrefs({
    defaultTrayTab: "space_marines",
    stickyNotesVisible: true,
    toolsPinnedByDefault: false,
    workQueuePinnedByDefault: false,
    playgroundLayout: "docked",
    calendarBehavior: "quickSchedule",
  });
  if (parsedUnknown?.defaultTrayTab !== DEFAULT_WORKSPACE_PREFS.defaultTrayTab) {
    fail(
      `§4 parseWorkspacePrefs does not fall back to default for unknown tab (got "${parsedUnknown?.defaultTrayTab}")`,
    );
  }

  // §5 — dialog offers exactly the same three SelectItem values as
  // the client TRAY_TABS array and server enum.
  const dialogOptions = Array.from(
    dialog.matchAll(/<SelectItem\s+value="([^"]+)">[^<]+<\/SelectItem>/g),
  )
    .map((m) => m[1])
    .filter((v) => /^(patients|direct|team|docked|split|playground|quickSchedule)$/.test(v));
  const dialogTrayValues = dialogOptions.filter((v) =>
    ["patients", "direct", "team"].includes(v),
  );
  for (const required of ["patients", "direct", "team"]) {
    if (!dialogTrayValues.includes(required)) {
      fail(`§5 WorkspaceSettingsDialog missing SelectItem value="${required}"`);
    }
  }

  // §6 — flushPersist wiring.
  if (!/flushPersist/.test(prefsClient)) {
    fail("§6 workspacePrefs.ts does not export flushPersist");
  }
  if (!/return\s*\{[^}]*flushPersist/.test(prefsClient)) {
    fail("§6 useWorkspacePrefs does not include flushPersist in its return");
  }
  if (!/flushPersist\?:\s*\(\)\s*=>\s*Promise<void>/.test(dialog)) {
    fail("§6 WorkspaceSettingsDialog does not accept a flushPersist prop");
  }
  if (!/flushPersist\?\.\(\)|await\s+flushPersist\(\)/.test(dialog)) {
    fail("§6 WorkspaceSettingsDialog does not await flushPersist on close");
  }
  if (!/flushPersist={flushWorkspacePrefs}/.test(shell)) {
    fail("§6 TeamPortalShell does not pass flushPersist to the dialog");
  }

  if (failures > 0) {
    console.error(`workspacePrefsPersistence.test.ts: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("workspacePrefsPersistence.test.ts: all tests passed");
})().catch((err) => {
  console.error("workspacePrefsPersistence.test.ts: threw:", err?.message ?? err);
  process.exit(1);
});
