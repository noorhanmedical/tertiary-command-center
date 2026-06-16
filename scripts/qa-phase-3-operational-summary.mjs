#!/usr/bin/env node
// QA — Phase 3 PR 3.8.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (m) => failures.push(m);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const mustExist = (p) => { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); };

mustExist("server/services/exceptionIntelligence/operationalSummaryService.ts");
mustExist("server/routes/operationalSummary.ts");
mustExist("client/src/lib/operationalSummaryApi.ts");
mustExist("client/src/pages/operational-summary.tsx");
mustExist("docs/architecture/phase-3-operational-summary.md");

if (failures.length) {
  console.error("[qa-phase-3-operational-summary] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

const svc = read("server/services/exceptionIntelligence/operationalSummaryService.ts");
// 1) Read-only
if (/db\.update|db\.insert|db\.delete/.test(svc)) {
  fail("operational summary service must be read-only");
}
// 2) Version exported
if (!/OPERATIONAL_SUMMARY_VERSION/.test(svc)) fail("must export OPERATIONAL_SUMMARY_VERSION");
// 3) Reads the canonical three Phase 3 tables
for (const t of ["exception_snapshots", "ai_recommendation_logs"]) {
  if (!svc.includes(t)) fail(`service must read ${t}`);
}
// 4) Includes the AI safety policy
if (!/getEffectiveAiSafetyPolicy/.test(svc)) fail("service must include effective safety policy");

const route = read("server/routes/operationalSummary.ts");
if (!/app\.get\(\s*"\/api\/operational-summary"\s*,\s*requireAdminOrBiller/.test(route)) {
  fail("GET /api/operational-summary must be admin/biller-gated");
}

const page = read("client/src/pages/operational-summary.tsx");
for (const ds of [
  "operational-summary-page",
  "operational-summary-meta",
  "opsum-exception-status", "opsum-exception-severity", "opsum-exception-type",
  "opsum-cycle-time", "opsum-acceptance",
  "opsum-rec-status", "opsum-rec-action", "opsum-rec-provider",
  "opsum-top-facilities", "opsum-top-detectors",
]) {
  if (!page.includes(ds)) fail(`page missing data-testid prefix: ${ds}`);
}

// 5) No autonomous mutation surface on the page
if (/automaticallyRetry|autoExecute|sendNow\(/i.test(page)) {
  fail("operational summary page must not expose execution");
}

if (failures.length) {
  console.error("[qa-phase-3-operational-summary] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("[qa-phase-3-operational-summary] PASS");
