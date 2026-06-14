// QA — Phase 2 hardening item 5: admin_settings testType scope.
//
// Run: node scripts/qa-phase-2-hardening-admin-settings-test-type-scope.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

if (!fs.existsSync(path.join(root, "migrations/0033_phase2_admin_settings_test_type_scope.sql"))) {
  failures.push("missing migration 0033_phase2_admin_settings_test_type_scope.sql");
}

const schema = fs.readFileSync(path.join(root, "shared/schema/adminSettings.ts"), "utf8");
if (!/testType:\s*text\("test_type"\)/.test(schema)) {
  failures.push("admin_settings schema must declare testType: text('test_type')");
}
if (!schema.includes("idx_admin_settings_domain_key_facility_user_test")) {
  failures.push("admin_settings schema must include the new unique index with test_type");
}

const repo = fs.readFileSync(path.join(root, "server/repositories/adminSettings.repo.ts"), "utf8");
if (!/testType\?\:\s*string \| null/.test(repo)) {
  failures.push("AdminSettingScope must include testType?: string | null");
}
// findOneSetting accepts testType.
if (!/testType === null \? isNull\(adminSettings\.testType\)/.test(repo)) {
  failures.push("findOneSetting must include test_type in the WHERE clause");
}
// Precedence: test-scoped variants checked before non-test ones.
if (!/if \(testType !== null\)/.test(repo)) {
  failures.push("getAdminSettingValue must branch on testType !== null before non-test variants");
}

const service = fs.readFileSync(
  path.join(root, "server/services/adminSettings/adminSettingsEffectiveService.ts"),
  "utf8",
);
if (!/source:\s*"test_type"/.test(service)) {
  failures.push("readWithSource must surface source = 'test_type' when a test-scoped row wins");
}
if (!/testType: scope\.testType/.test(service)) {
  failures.push("readWithSource must forward scope.testType into getAdminSettingValue");
}
if (!/testType: scope\.testType \?\? null/.test(service)) {
  failures.push("bundle scope must echo testType (null when not supplied)");
}

const route = fs.readFileSync(path.join(root, "server/routes/adminSettings.ts"), "utf8");
if (!/testType:\s*q\.testType \?\? null/.test(route)) {
  failures.push("/api/admin-settings/effective must read testType from the query");
}
if (!/testType:\s*z\.string\(\)\.optional\(\)\.nullable\(\)/.test(route)) {
  failures.push("POST /api/admin-settings body schema must accept testType");
}

const client = fs.readFileSync(path.join(root, "client/src/lib/adminSettingsApi.ts"), "utf8");
if (!/testType:\s*string \| null/.test(client)) {
  failures.push("AdminSettingRow.testType type must be string | null");
}
if (!/test_type/.test(client)) {
  failures.push("client API sources type must include 'test_type'");
}
if (!/testType\?:\s*string \| null/.test(client)) {
  failures.push("fetchEffectiveAdminSettings must accept testType in scope");
}

const page = fs.readFileSync(path.join(root, "client/src/pages/admin-settings-center.tsx"), "utf8");
if (!/test:\s*\$\{row\.testType\}/.test(page)) {
  failures.push("Admin Settings Center row label must show test scope when set");
}

if (failures.length > 0) {
  console.error("Phase-2 hardening admin-settings test-type-scope QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 hardening admin-settings test-type-scope QA passed.");
