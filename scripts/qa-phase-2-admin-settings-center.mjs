// QA — Phase 2 Admin Settings Center: page exists, routes exist,
// effective-settings service exists, seed rows for the new PR 2.1
// settings are present.
//
// Run: node scripts/qa-phase-2-admin-settings-center.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED_FILES = [
  "client/src/pages/admin-settings-center.tsx",
  "client/src/lib/adminSettingsApi.ts",
  "server/services/adminSettings/adminSettingsEffectiveService.ts",
  "docs/architecture/phase-2-admin-settings-runtime.md",
];
for (const f of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(root, f))) {
    failures.push(`missing: ${f}`);
  }
}

const routes = fs.readFileSync(path.join(root, "server/routes/adminSettings.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/admin-settings"',
  'app.get("/api/admin-settings/effective"',
  'app.get("/api/admin-settings/:id"',
  'app.post("/api/admin-settings"',
  'app.patch("/api/admin-settings/:id"',
];
for (const r of REQUIRED_ROUTES) {
  if (!routes.includes(r)) {
    failures.push(`adminSettings.ts must register ${r}`);
  }
}
// Admin-only gating on writes.
if (!/requireAdmin/.test(routes)) {
  failures.push("adminSettings.ts must define and use requireAdmin middleware on write routes");
}

const seed = fs.readFileSync(path.join(root, "server/repositories/adminSettings.repo.ts"), "utf8");
const REQUIRED_SEED_KEYS = [
  '"engagement_center", settingKey: "max_call_attempts"',
  '"engagement_center", settingKey: "dnc_is_terminal"',
  '"engagement_center", settingKey: "declined_is_terminal"',
  '"engagement_center", settingKey: "ready_to_schedule_routes_to_triage"',
  '"engagement_center", settingKey: "scheduled_closes_assignment"',
  '"engagement_center", settingKey: "queue_reentry_enabled"',
  '"assignment", settingKey: "scheduler_auto_assign_enabled"',
  '"assignment", settingKey: "pcs_assignment_respects_facility_scope"',
  '"assignment", settingKey: "acs_assignment_respects_facility_scope"',
];
for (const k of REQUIRED_SEED_KEYS) {
  if (!seed.includes(k)) {
    failures.push(`admin settings seed missing: ${k}`);
  }
}

const service = fs.readFileSync(path.join(root, "server/services/adminSettings/adminSettingsEffectiveService.ts"), "utf8");
if (!service.includes("export async function getEffectiveAdminSettings")) {
  failures.push("adminSettingsEffectiveService must export getEffectiveAdminSettings");
}
// Precedence: facility → user → global → default.
if (!/scope\.facilityId != null/.test(service) || !/scope\.userId != null/.test(service)) {
  failures.push("effective service must consult facility AND user scopes before falling back to global");
}

// Page wired into App.tsx.
const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("AdminSettingsCenterPage")) {
  failures.push("App.tsx must import AdminSettingsCenterPage");
}
if (!app.includes("/admin/settings-center")) {
  failures.push("App.tsx must register /admin/settings-center route");
}
// Must be gated by AdminGuard.
if (!/AdminGuard[^<]*<AdminSettingsCenterPage/.test(app)) {
  failures.push("/admin/settings-center route must be wrapped in <AdminGuard>");
}

if (failures.length > 0) {
  console.error("Phase-2 Admin Settings Center QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 Admin Settings Center QA passed.");
