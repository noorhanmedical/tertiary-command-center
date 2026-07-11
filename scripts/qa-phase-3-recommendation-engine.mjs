#!/usr/bin/env node
// QA — Phase 3 PR 3.5: recommendation engine.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (m) => failures.push(m);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const mustExist = (p) => { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); };

mustExist("server/services/exceptionIntelligence/recommendationRules.ts");
mustExist("server/services/exceptionIntelligence/recommendationEngine.ts");
mustExist("docs/architecture/phase-3-recommendation-engine.md");

if (failures.length) {
  console.error("[qa-phase-3-recommendation-engine] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

const rules = read("server/services/exceptionIntelligence/recommendationRules.ts");
// 1) PR 3.2 detector coverage must exist as rules
for (const t of [
  "callback_overdue", "payment_overdue", "invoice_delivery_failed",
  "invoice_readiness_blocked", "physician_signature_pending", "denial_followup_due",
]) {
  if (!new RegExp(`${t}:\\s*\\w+Rule|"${t}"`).test(rules)) {
    fail(`recommendation rules missing detector coverage for: ${t}`);
  }
}

const engine = read("server/services/exceptionIntelligence/recommendationEngine.ts");
// 2) Engine must hard-force rules_engine + not_applicable per the AI safety contract
if (!/modelProvider:\s*"rules_engine"/.test(engine)) fail("engine must hard-force modelProvider=rules_engine");
if (!/confidenceLabel:\s*"not_applicable"/.test(engine)) fail("engine must hard-force confidenceLabel=not_applicable");
// 3) Engine must never execute external actions
if (/sendEmail|sendSms|markBilling|markReady|markComplete|chargeCard/i.test(engine)) {
  fail("engine must not execute external actions");
}
// 4) Deterministic recommendation_key
if (!/`\$\{ex\.exceptionType\}:\$\{ex\.id\}`/.test(engine)) {
  fail("engine must use deterministic recommendation_key (exceptionType:id)");
}
// 5) Engine must log proposals via the contract logger
if (!/logProposal\(/.test(engine)) fail("engine must persist via logProposal");

// 6) Route must be wired admin/biller
const routes = read("server/routes/exceptions.ts");
if (!/app\.post\(\s*"\/api\/exceptions\/recommend"\s*,\s*requireAdminOrBiller/.test(routes)) {
  fail("POST /api/exceptions/recommend must be admin/biller gated");
}
if (!/proposeRecommendationsForOpenExceptions/.test(routes)) {
  fail("exceptions route must import the recommendation engine");
}

// 7) UI must surface the proposal button + per-exception recommendations
const page = read("client/src/pages/exceptions.tsx");
if (!/exceptions-propose-recommendations/.test(page)) {
  fail("exceptions page must have a 'Propose recommendations' button");
}
const panel = read("client/src/components/exceptions/ExceptionReviewPanel.tsx");
if (!/exception-recommendations-/.test(panel) || !/exception-recommendation-/.test(panel)) {
  fail("ExceptionReviewPanel must surface related recommendations");
}

// 8) No autonomous side effects
const all = engine + rules;
if (/setTimeout\(|setInterval\(/.test(engine)) {
  fail("engine must not schedule background work");
}
if (/process\.exit/.test(engine + rules)) {
  fail("engine/rules must not call process.exit");
}

if (failures.length) {
  console.error("[qa-phase-3-recommendation-engine] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("[qa-phase-3-recommendation-engine] PASS");
