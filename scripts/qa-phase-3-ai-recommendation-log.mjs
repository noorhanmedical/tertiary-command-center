#!/usr/bin/env node
// QA — Phase 3 PR 3.4: AI recommendation log + explainability.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (m) => failures.push(m);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const mustExist = (p) => { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); };

mustExist("shared/contracts/aiRecommendation.ts");
mustExist("shared/schema/aiRecommendationLogs.ts");
mustExist("migrations/0041_phase3_ai_recommendation_logs.sql");
mustExist("server/services/exceptionIntelligence/aiSafetyPolicyService.ts");
mustExist("server/services/exceptionIntelligence/aiRecommendationLogService.ts");
mustExist("server/routes/aiRecommendations.ts");
mustExist("client/src/lib/aiRecommendationsApi.ts");
mustExist("client/src/pages/ai-recommendations.tsx");
mustExist("docs/architecture/phase-3-ai-recommendation-log.md");

if (failures.length) {
  console.error("[qa-phase-3-ai-recommendation-log] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

// 1) Contract must enumerate canonical vocabulary
const contract = read("shared/contracts/aiRecommendation.ts");
for (const v of ["rules_engine", "openai", "other", "not_configured"]) {
  if (!contract.includes(`"${v}"`)) fail(`contract missing modelProvider literal "${v}"`);
}
for (const v of ["not_applicable", "low", "medium", "high"]) {
  if (!contract.includes(`"${v}"`)) fail(`contract missing confidenceLabel literal "${v}"`);
}
if (!/humanReviewRequired:\s*true/.test(contract)) {
  fail("contract must hard-force humanReviewRequired: true");
}
if (!/autoActionsEnabled:\s*false/.test(contract)) {
  fail("contract must hard-force autoActionsEnabled: false");
}

// 2) Schema must define table + dedupe key + status default
const schema = read("shared/schema/aiRecommendationLogs.ts");
if (!/aiRecommendationLogs\s*=\s*pgTable\("ai_recommendation_logs"/.test(schema)) {
  fail("schema must define ai_recommendation_logs table");
}
if (!/uniqueIndex\("idx_ai_recommendation_logs_key"\)/.test(schema)) {
  fail("schema must enforce recommendation_key uniqueness");
}
if (!/status:\s*text\("status"\)\.notNull\(\)\.default\("proposed"\)/.test(schema)) {
  fail("schema status default must be 'proposed'");
}

// 3) Migration must create table + indexes
const mig = read("migrations/0041_phase3_ai_recommendation_logs.sql");
if (!/CREATE TABLE IF NOT EXISTS\s+"?ai_recommendation_logs"?/i.test(mig)) {
  fail("migration must CREATE TABLE ai_recommendation_logs");
}
if (!/idx_ai_recommendation_logs_key/.test(mig)) fail("migration missing recommendation_key unique index");
if (!/idx_ai_recommendation_logs_status/.test(mig)) fail("migration missing status index");

// 4) Safety policy service must hard-force the contract
const safety = read("server/services/exceptionIntelligence/aiSafetyPolicyService.ts");
if (!/humanReviewRequired:\s*true/.test(safety)) {
  fail("safety policy must always return humanReviewRequired: true");
}
if (!/autoActionsEnabled:\s*false/.test(safety)) {
  fail("safety policy must always return autoActionsEnabled: false");
}
if (!/OPENAI_API_KEY/.test(safety)) {
  fail("safety policy must consult OPENAI_API_KEY when openai is the default");
}

// 5) Log service must validate vocabulary and refuse rules+confidence mismatch
const logSvc = read("server/services/exceptionIntelligence/aiRecommendationLogService.ts");
if (!/rules_engine must report confidenceLabel=not_applicable/.test(logSvc)) {
  fail("log service must refuse rules_engine + non-not_applicable confidence");
}
for (const fn of ["logProposal", "acceptRecommendation", "rejectRecommendation", "listRecommendations"]) {
  if (!new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`).test(logSvc)) fail(`log service missing: ${fn}`);
}
if (!/Rejection reason required/.test(logSvc)) {
  fail("rejectRecommendation must require a reason");
}
if (!/recommendation_accepted/.test(logSvc) || !/recommendation_rejected/.test(logSvc)) {
  fail("log service must append exception_review_events for accept/reject");
}
if (/sendEmail|sendSms|markBilling|markReady|scheduleCallback\(/i.test(logSvc)) {
  fail("log service must not execute external actions");
}

// 6) Routes must register correct gates
const routes = read("server/routes/aiRecommendations.ts");
const expected = [
  [/app\.get\(\s*"\/api\/ai-recommendations\/safety-policy"\s*,\s*requireAuth/, "GET safety-policy requireAuth"],
  [/app\.get\(\s*"\/api\/ai-recommendations"\s*,\s*requireAuth/, "GET list requireAuth"],
  [/app\.get\(\s*"\/api\/ai-recommendations\/:id"\s*,\s*requireAuth/, "GET :id requireAuth"],
  [/app\.post\(\s*"\/api\/ai-recommendations\/:id\/accept"\s*,\s*requireAdminOrBiller/, "POST accept requireAdminOrBiller"],
  [/app\.post\(\s*"\/api\/ai-recommendations\/:id\/reject"\s*,\s*requireAdminOrBiller/, "POST reject requireAdminOrBiller"],
];
for (const [re, label] of expected) if (!re.test(routes)) fail(`route missing: ${label}`);

// 7) Page must surface accept/reject UI + safety policy badges
const page = read("client/src/pages/ai-recommendations.tsx");
for (const ds of [
  "ai-recommendations-page", "policy-effective-provider",
  "policy-human-review-required", "policy-auto-actions-disabled",
  "ai-rec-accept-", "ai-rec-reject-", "ai-rec-reject-reason-",
  "ai-recommendation-", "ai-rec-tab-",
]) {
  if (!page.includes(ds)) fail(`page missing data-testid prefix: ${ds}`);
}

// 8) Forbid client auto-execution surface
if (/automaticallyExecute|autoApprove|skipReview/i.test(page)) {
  fail("page must not advertise automatic execution");
}

if (failures.length) {
  console.error("[qa-phase-3-ai-recommendation-log] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("[qa-phase-3-ai-recommendation-log] PASS");
