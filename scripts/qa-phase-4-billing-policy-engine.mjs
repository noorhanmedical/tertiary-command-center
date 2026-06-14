// QA — Phase 4 PR 4.1 billing policy engine.
//
// Run: node scripts/qa-phase-4-billing-policy-engine.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/contracts/billingPolicy.ts",
  "server/services/billing/billingPolicyService.ts",
  "server/routes/billingPolicy.ts",
  "client/src/lib/billingPolicyApi.ts",
  "client/src/pages/billing-settings.tsx",
  "script/seedBillingPolicies.ts",
  "docs/architecture/phase-4-billing-policy-engine.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const contract = fs.readFileSync(path.join(root, "shared/contracts/billingPolicy.ts"), "utf8");
const REQUIRED_KEYS = [
  "scheduleFrequency", "scheduleCutoffWindow", "scheduleTimezone",
  "primaryEmail", "deliveryMethod", "perTestPrice",
  "revenueSplit", "holdMissingReport", "holdPendingPhysicianSignature",
  "approvalRequirement", "paymentTerm", "reminderIntervalDays",
];
for (const k of REQUIRED_KEYS) {
  if (!contract.includes(k)) failures.push(`BILLING_POLICY_KEYS must include "${k}"`);
}

const service = fs.readFileSync(path.join(root, "server/services/billing/billingPolicyService.ts"), "utf8");
if (!service.includes("export async function getEffectiveBillingPolicy")) {
  failures.push("billingPolicyService must export getEffectiveBillingPolicy");
}
// Honors precedence: test → facility → user → global.
if (!/scope\.testType != null/.test(service) || !/source: "test_type"/.test(service)) {
  failures.push("billingPolicyService must check testType first and emit source='test_type'");
}
if (!/source: "facility"/.test(service) || !/source: "user"/.test(service) || !/source: "global"/.test(service) || !/source: "default"/.test(service)) {
  failures.push("billingPolicyService must surface every source label");
}

const route = fs.readFileSync(path.join(root, "server/routes/billingPolicy.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/billing-policy/effective"',
  'app.get("/api/billing-policy/settings"',
  'app.post("/api/billing-policy/settings"',
  'app.patch("/api/billing-policy/settings/:id"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`billingPolicy route missing ${r}`);
}
if (!route.includes("requireAdmin")) {
  failures.push("billingPolicy writes must be admin-gated");
}

const seed = fs.readFileSync(path.join(root, "script/seedBillingPolicies.ts"), "utf8");
// Seed defaults to safe baseline (download_only, monthly, approval admin, net_15).
const SEED_DEFAULTS = ['"download_only"', '"monthly"', '"admin"', '"net_15"'];
for (const v of SEED_DEFAULTS) {
  if (!seed.includes(v)) failures.push(`seed must include safe default ${v}`);
}
// Honest skip when DATABASE_URL is unavailable.
if (!seed.includes("DATABASE_URL unavailable")) {
  failures.push("seed must honestly skip without DATABASE_URL");
}

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/admin/billing-settings")) {
  failures.push("App.tsx must register /admin/billing-settings");
}
if (!/AdminGuard[^<]*<BillingSettingsPage/.test(app)) {
  failures.push("/admin/billing-settings must be wrapped in <AdminGuard>");
}

const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
if (!pkg.includes("seed:billing-policies")) {
  failures.push("package.json must register seed:billing-policies script");
}

const routes = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
if (!routes.includes("registerBillingPolicyRoutes")) {
  failures.push("server/routes.ts must register billing policy routes");
}

if (failures.length > 0) {
  console.error("Phase-4 billing-policy-engine QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 billing-policy-engine QA passed.");
