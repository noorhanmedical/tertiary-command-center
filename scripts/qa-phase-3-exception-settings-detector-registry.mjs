// QA — Phase 3 PR 3.1 exception settings + detector registry.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/contracts/exceptionIntelligence.ts",
  "server/services/exceptionIntelligence/detectorRegistry.ts",
  "server/services/exceptionIntelligence/exceptionSettingsService.ts",
  "server/routes/exceptionSettings.ts",
  "client/src/lib/exceptionSettingsApi.ts",
  "client/src/pages/exception-settings.tsx",
  "script/seedExceptionSettings.ts",
  "docs/architecture/phase-3-exception-settings-detector-registry.md",
];
for (const r of REQUIRED) if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);

const contract = fs.readFileSync(path.join(root, "shared/contracts/exceptionIntelligence.ts"), "utf8");
const REQUIRED_TYPES = ["callback_overdue", "report_missing", "physician_signature_pending", "invoice_readiness_blocked", "payment_overdue", "denial_followup_due", "no_show_followup_due"];
for (const t of REQUIRED_TYPES) if (!contract.includes(`"${t}"`)) failures.push(`ExceptionType must include "${t}"`);

const registry = fs.readFileSync(path.join(root, "server/services/exceptionIntelligence/detectorRegistry.ts"), "utf8");
if (!registry.includes("DETECTOR_REGISTRY")) failures.push("registry must export DETECTOR_REGISTRY");
for (const t of REQUIRED_TYPES) if (!registry.includes(`"${t}"`)) failures.push(`registry must define "${t}"`);

const service = fs.readFileSync(path.join(root, "server/services/exceptionIntelligence/exceptionSettingsService.ts"), "utf8");
if (!service.includes("export async function getEffectiveExceptionPolicy")) failures.push("must export getEffectiveExceptionPolicy");
if (!/autoActionsEnabled:\s*asBoolean[\s\S]*?false\)/.test(service)) failures.push("autoActionsEnabled must default to false");
if (!/humanReviewRequired:\s*asBoolean[\s\S]*?true\)/.test(service)) failures.push("humanReviewRequired must default to true");

const route = fs.readFileSync(path.join(root, "server/routes/exceptionSettings.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/exception-settings/effective"',
  'app.get("/api/exception-settings/settings"',
  'app.post("/api/exception-settings/settings"',
  'app.patch("/api/exception-settings/settings/:id"',
];
for (const r of REQUIRED_ROUTES) if (!route.includes(r)) failures.push(`route must register ${r}`);
if (!route.includes("requireAdmin")) failures.push("writes must be admin-gated");

const seed = fs.readFileSync(path.join(root, "script/seedExceptionSettings.ts"), "utf8");
if (!seed.includes('"human_review_required"')) failures.push("seed must include human_review_required");
if (!seed.includes('"auto_actions_enabled"') || !/auto_actions_enabled"[\s\S]*?value: false/.test(seed)) failures.push("seed must default auto_actions_enabled to false");
if (!seed.includes("DATABASE_URL unavailable")) failures.push("seed must honest-skip without DATABASE_URL");

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/admin/exception-settings")) failures.push("App.tsx must register /admin/exception-settings");
if (!/AdminGuard[^<]*<ExceptionSettingsPage/.test(app)) failures.push("/admin/exception-settings must be wrapped in <AdminGuard>");

const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
if (!pkg.includes("seed:exception-settings")) failures.push("package.json must register seed:exception-settings");

const routes = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
if (!routes.includes("registerExceptionSettingsRoutes")) failures.push("server/routes.ts must register exception settings routes");

if (failures.length > 0) {
  console.error("Phase-3 exception-settings-detector-registry QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 exception-settings-detector-registry QA passed.");
