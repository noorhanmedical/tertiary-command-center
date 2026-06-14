// Smoke — Phase 4 PR 4.1 billing policy chain.
//
// Run: node scripts/smoke-phase-4-billing-policy-engine.mjs

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
  "1. Shared contract exports EffectiveBillingPolicy + key map",
  "shared/contracts/billingPolicy.ts",
  (s) => s.includes("EffectiveBillingPolicy") && s.includes("BILLING_POLICY_KEYS"),
);
check(
  "2. Service builds bundle + sources ledger",
  "server/services/billing/billingPolicyService.ts",
  (s) => s.includes("getEffectiveBillingPolicy") && s.includes("sources"),
);
check(
  "3. Route exposes the 4 endpoints",
  "server/routes/billingPolicy.ts",
  (s) =>
    s.includes('app.get("/api/billing-policy/effective"') &&
    s.includes('app.get("/api/billing-policy/settings"') &&
    s.includes('app.post("/api/billing-policy/settings"') &&
    s.includes('app.patch("/api/billing-policy/settings/:id"'),
);
check(
  "4. Client API exports the 4 helpers",
  "client/src/lib/billingPolicyApi.ts",
  (s) =>
    s.includes("fetchEffectiveBillingPolicy") &&
    s.includes("fetchBillingPolicySettings") &&
    s.includes("createBillingPolicy") &&
    s.includes("patchBillingPolicy"),
);
check(
  "5. Page consumes the bundle + scope inputs + source badges",
  "client/src/pages/billing-settings.tsx",
  (s) =>
    s.includes("fetchEffectiveBillingPolicy") &&
    s.includes("billing-settings-facility-input") &&
    s.includes("billing-settings-testtype-input"),
);
check(
  "6. App.tsx registers /admin/billing-settings under AdminGuard",
  "client/src/App.tsx",
  (s) =>
    s.includes("/admin/billing-settings") &&
    /AdminGuard[^<]*<BillingSettingsPage/.test(s),
);
check(
  "7. Seed honors honest skip",
  "script/seedBillingPolicies.ts",
  (s) => s.includes("DATABASE_URL unavailable") && s.includes("seed:billing-policies"),
);
check(
  "8. Service uses Phase 2 hardening admin_settings precedence",
  "server/services/billing/billingPolicyService.ts",
  (s) =>
    s.includes("getAdminSettingValue") &&
    /scope\.testType != null/.test(s) &&
    /scope\.facilityId != null/.test(s),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: Phase 4 billing policy chain intact.");
