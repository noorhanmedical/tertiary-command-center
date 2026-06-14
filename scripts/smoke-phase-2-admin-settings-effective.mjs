// Smoke — Phase 2 effective-settings runtime chain.
//
// Walks the static chain from seed → service → route → client → page,
// asserting that each link references the next with the correct
// types. End-to-end test against a DB is in the PR 2.10 live probes.
//
// Run: node scripts/smoke-phase-2-admin-settings-effective.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

check(
  "1. Seed includes the 9 PR 2.1 effective-bundle keys",
  "server/repositories/adminSettings.repo.ts",
  (s) =>
    s.includes('"max_call_attempts"') &&
    s.includes('"dnc_is_terminal"') &&
    s.includes('"declined_is_terminal"') &&
    s.includes('"ready_to_schedule_routes_to_triage"') &&
    s.includes('"scheduled_closes_assignment"') &&
    s.includes('"queue_reentry_enabled"') &&
    s.includes('"scheduler_auto_assign_enabled"') &&
    s.includes('"pcs_assignment_respects_facility_scope"') &&
    s.includes('"acs_assignment_respects_facility_scope"'),
);

check(
  "2. Effective service returns a typed bundle with sources ledger",
  "server/services/adminSettings/adminSettingsEffectiveService.ts",
  (s) =>
    s.includes("EffectiveAdminSettingsBundle") &&
    s.includes("sources: Record<string,") &&
    s.includes('"facility" | "user" | "global" | "default"'),
);

check(
  "3. Effective service applies facility → user → global → default order",
  "server/services/adminSettings/adminSettingsEffectiveService.ts",
  (s) =>
    /scope\.facilityId != null/.test(s) &&
    /scope\.userId != null/.test(s) &&
    /source: "default"/.test(s),
);

check(
  "4. Route GET /api/admin-settings/effective wired",
  "server/routes/adminSettings.ts",
  (s) => s.includes('app.get("/api/admin-settings/effective"'),
);

check(
  "5. Client API exposes fetchEffectiveAdminSettings",
  "client/src/lib/adminSettingsApi.ts",
  (s) => s.includes("export async function fetchEffectiveAdminSettings"),
);

check(
  "6. Page consumes the effective bundle + source badges",
  "client/src/pages/admin-settings-center.tsx",
  (s) =>
    s.includes('fetchEffectiveAdminSettings') &&
    s.includes('sources["scheduling_triage.default_callback_due_hours"]') &&
    s.includes('sources["engagement_center.max_call_attempts"]'),
);

check(
  "7. Page registered in App.tsx under AdminGuard at /admin/settings-center",
  "client/src/App.tsx",
  (s) =>
    s.includes("/admin/settings-center") &&
    /AdminGuard[^<]*<AdminSettingsCenterPage/.test(s),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: Phase 2 effective-settings chain intact.");
