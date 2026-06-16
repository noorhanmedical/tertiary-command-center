#!/usr/bin/env node
// Smoke — Phase 3 PR 3.8.

import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd());
const read = (p) => readFileSync(path.join(root, p), "utf8");
const failures = [];
const fail = (m) => failures.push(m);

const app = read("server/routes.ts");
if (!/registerOperationalSummaryRoutes\(app\)/.test(app)) fail("routes.ts must register operationalSummary routes");
if (!/from "\.\/routes\/operationalSummary"/.test(app)) fail("routes.ts must import operationalSummary route file");

const client = read("client/src/App.tsx");
if (!/OperationalSummaryPage/.test(client)) fail("App.tsx must mount OperationalSummaryPage");
if (!/\/admin\/operational-summary/.test(client)) fail("App.tsx must route /admin/operational-summary");

const api = read("client/src/lib/operationalSummaryApi.ts");
if (!/fetchOperationalSummary\(/.test(api)) fail("API must export fetchOperationalSummary");

if (failures.length) {
  console.error("[smoke-phase-3-operational-summary] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[smoke-phase-3-operational-summary] PASS");
