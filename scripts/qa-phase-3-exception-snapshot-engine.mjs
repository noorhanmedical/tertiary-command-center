// QA — Phase 3 PR 3.2 exception snapshot engine.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "shared/schema/exceptionSnapshots.ts",
  "migrations/0039_phase3_exception_snapshots.sql",
  "server/services/exceptionIntelligence/exceptionSnapshotEngine.ts",
  "server/repositories/exceptionSnapshots.repo.ts",
  "server/routes/exceptions.ts",
  "client/src/lib/exceptionsApi.ts",
  "client/src/pages/exceptions.tsx",
  "client/src/components/exceptions/ExceptionReviewPanel.tsx",
  "docs/architecture/phase-3-exception-snapshot-engine.md",
];
for (const r of REQUIRED) if (!fs.existsSync(path.join(root, r))) failures.push(`missing ${r}`);

const schema = fs.readFileSync(path.join(root, "shared/schema/exceptionSnapshots.ts"), "utf8");
const REQUIRED_STATUSES = ["open", "acknowledged", "in_review", "resolved", "dismissed", "superseded"];
for (const s of REQUIRED_STATUSES) if (!schema.includes(`"${s}"`)) failures.push(`EXCEPTION_STATUSES must include "${s}"`);
if (!schema.includes("idx_exception_snapshots_key")) failures.push("schema must declare unique exception_key index");

const engine = fs.readFileSync(path.join(root, "server/services/exceptionIntelligence/exceptionSnapshotEngine.ts"), "utf8");
if (!engine.includes("export async function evaluateExceptions")) failures.push("engine must export evaluateExceptions");
if (!engine.includes("getEffectiveExceptionPolicy")) failures.push("engine must read the policy bundle");
// Engine must not write to patient/invoice state.
if (/db\.update\(invoices\)|db\.update\(patientExecutionCases\)|db\.update\(globalScheduleEvents\)/.test(engine)) {
  failures.push("engine must not write to patient/invoice/schedule state");
}
// Engine writes only to exception_snapshots.
if (!/upsertException\(/.test(engine)) failures.push("engine must use upsertException helper");
if (!/markSuperseded\(/.test(engine)) failures.push("engine must mark stale snapshots superseded");

const route = fs.readFileSync(path.join(root, "server/routes/exceptions.ts"), "utf8");
const REQUIRED_ROUTES = [
  'app.get("/api/exceptions"',
  'app.get("/api/exceptions/:id"',
  'app.post("/api/exceptions/evaluate"',
  'app.post("/api/exceptions/evaluate-facility"',
  'app.post("/api/exceptions/evaluate-all-safe"',
];
for (const r of REQUIRED_ROUTES) if (!route.includes(r)) failures.push(`route must register ${r}`);
if (!route.includes("requireAdminOrBiller")) failures.push("evaluate routes must be admin/biller gated");

const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
if (!app.includes("/exceptions")) failures.push("App.tsx must register /exceptions");

const routes = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
if (!routes.includes("registerExceptionsRoutes")) failures.push("server/routes.ts must register exceptions routes");

if (failures.length > 0) {
  console.error("Phase-3 exception-snapshot-engine QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-3 exception-snapshot-engine QA passed.");
