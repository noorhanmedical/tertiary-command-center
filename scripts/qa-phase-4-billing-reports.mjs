// QA — Phase 4 PR 4.8 billing reports.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "server/services/billing/billingReportService.ts",
  "server/routes/billingReports.ts",
  "client/src/lib/billingReportsApi.ts",
  "client/src/pages/billing-reports.tsx",
  "docs/architecture/phase-4-billing-reports.md",
];
for (const r of REQUIRED) {
  if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);
}

const service = fs.readFileSync(path.join(root, "server/services/billing/billingReportService.ts"), "utf8");
if (!service.includes("export async function buildEodReport")) failures.push("service must export buildEodReport");
if (!service.includes("export async function buildWeeklyReport")) failures.push("service must export buildWeeklyReport");
if (!service.includes("export async function buildMonthlyReport")) failures.push("service must export buildMonthlyReport");
if (/db\.insert|db\.update|db\.delete/.test(service)) failures.push("report service must be read-only");

const route = fs.readFileSync(path.join(root, "server/routes/billingReports.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/billing-reports/eod"',
  'app.get("/api/billing-reports/weekly"',
  'app.get("/api/billing-reports/monthly"',
  'app.get("/api/billing-reports/facility/:facilityId"',
];
for (const r of REQUIRED_ROUTES) {
  if (!route.includes(r)) failures.push(`report route must register ${r}`);
}

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/billing/reports")) failures.push("App.tsx must register /billing/reports");

if (failures.length > 0) {
  console.error("Phase-4 billing-reports QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-4 billing-reports QA passed.");
