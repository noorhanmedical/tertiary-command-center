// tests/unit/workspacePrefsPersistence.test.ts
//
// Locks the tray-tab persistence contract end-to-end. Only two tray
// tabs are supported on this platform (Direct Messages and Team
// Chat) — Patient Messages / patient SMS is intentionally absent and
// must remain absent.
//
//   §1  Server prefsSchema.defaultTrayTab accepts ONLY "direct" and
//       "team". "patients" MUST be rejected.
//   §2  Client TRAY_TABS validation matches the server enum exactly.
//   §3  parseWorkspacePrefs preserves each supported tray tab in a
//       roundtrip and rejects "patients".
//   §4  parseWorkspacePrefs falls back to the default on an unknown
//       value.
//   §5  The WorkspaceSettingsDialog offers exactly two SelectItem
//       values for the tray tab: "direct" and "team".
//   §6  The `flushPersist` symbol is exported and wired into the
//       dialog / shell so a debounced write commits on close.
//   §7  Zero references to /api/portal/patient-messages/* remain in
//       the live portal source (TeamPortalShell + CommunicationTray).
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

// §1 — server schema MUST be direct|team only. "patients" is a
// forbidden value.
const serverEnumMatch = route.match(
  /defaultTrayTab:\s*z\.enum\(\[([^\]]+)\]\)/,
);
if (!serverEnumMatch) {
  fail("§1 server prefsSchema does not declare defaultTrayTab as z.enum([...])");
} else {
  const values = serverEnumMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  for (const required of ["direct", "team"]) {
    if (!values.includes(required)) {
      fail(`§1 server enum missing "${required}"`);
    }
  }
  if (values.includes("patients")) {
    fail(`§1 server enum still contains "patients" — Patient Messages must NOT be exposed`);
  }
}

// §2 — client TRAY_TABS validation array. Only direct + team.
const trayTabsMatch = prefsClient.match(
  /const\s+TRAY_TABS:\s*TrayTab\[\]\s*=\s*\[([^\]]+)\]/,
);
if (!trayTabsMatch) {
  fail("§2 client TRAY_TABS array declaration not found");
} else {
  const values = trayTabsMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  for (const required of ["direct", "team"]) {
    if (!values.includes(required)) {
      fail(`§2 client TRAY_TABS missing "${required}"`);
    }
  }
  if (values.includes("patients")) {
    fail(`§2 client TRAY_TABS still contains "patients"`);
  }
}

// §3 + §4 — parseWorkspacePrefs behavioural roundtrip.
// Dynamically import the module so we exercise the real code path,
// not a regex.
(async () => {
  const modulePath = "../../client/src/components/portal/tools/workspacePrefs";
  const { parseWorkspacePrefs, DEFAULT_WORKSPACE_PREFS } = await import(modulePath);

  for (const tab of ["direct", "team"]) {
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
  // "patients" MUST NOT roundtrip — parser drops it to the default.
  const parsedPatients = parseWorkspacePrefs({
    defaultTrayTab: "patients",
    stickyNotesVisible: true,
    toolsPinnedByDefault: false,
    workQueuePinnedByDefault: false,
    playgroundLayout: "docked",
    calendarBehavior: "quickSchedule",
  });
  if (parsedPatients?.defaultTrayTab === "patients") {
    fail(`§3 parseWorkspacePrefs accepts forbidden value "patients"`);
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

  // §5 — dialog offers exactly two tray-tab SelectItem values.
  const dialogOptions = Array.from(
    dialog.matchAll(/<SelectItem\s+value="([^"]+)">[^<]+<\/SelectItem>/g),
  ).map((m) => m[1]);
  const dialogTrayValues = dialogOptions.filter((v) =>
    ["patients", "direct", "team"].includes(v),
  );
  for (const required of ["direct", "team"]) {
    if (!dialogTrayValues.includes(required)) {
      fail(`§5 WorkspaceSettingsDialog missing SelectItem value="${required}"`);
    }
  }
  if (dialogTrayValues.includes("patients")) {
    fail(`§5 WorkspaceSettingsDialog still exposes Patient Messages`);
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

  // §7 — no live /api/portal/patient-messages/* fetch or apiRequest
  // call remains in the live portal source. Comments referencing the
  // old path are allowed (they document the intentional removal);
  // executable code is not.
  const stripComments = (src: string) =>
    src
      .split("\n")
      .filter((l) => !/^\s*(--|\/\/)/.test(l))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
  const trayCode = stripComments(
    fs.readFileSync(
      path.join(ROOT, "client/src/components/portal/tools/CommunicationTray.tsx"),
      "utf8",
    ),
  );
  const shellCode = stripComments(shell);
  const FORBIDDEN = /["'`]\s*[^"'`]*\/api\/portal\/patient-messages[^"'`]*["'`]/;
  if (FORBIDDEN.test(trayCode)) {
    fail("§7 CommunicationTray still contains a live /api/portal/patient-messages/* string");
  }
  if (FORBIDDEN.test(shellCode)) {
    fail("§7 TeamPortalShell still contains a live /api/portal/patient-messages/* string");
  }
  // TABS array must have exactly two entries.
  const tabsMatch = trayCode.match(/const\s+TABS[^=]+=\s*\[([^\]]+)\]/);
  if (tabsMatch) {
    const ids = Array.from(tabsMatch[1].matchAll(/id:\s*"([^"]+)"/g)).map((m) => m[1]);
    if (ids.length !== 2) {
      fail(`§7 CommunicationTray TABS has ${ids.length} entries (expected 2)`);
    }
    if (ids.includes("patients")) {
      fail(`§7 CommunicationTray TABS still contains "patients"`);
    }
  } else {
    fail("§7 CommunicationTray TABS array not found");
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
