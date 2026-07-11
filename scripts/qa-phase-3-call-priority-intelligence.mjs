#!/usr/bin/env node
// QA — Phase 3 PR 3.7: scheduling / call priority intelligence.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const failures = [];
const fail = (m) => failures.push(m);
const read = (p) => readFileSync(path.join(root, p), "utf8");
const mustExist = (p) => { if (!existsSync(path.join(root, p))) fail(`missing file: ${p}`); };

mustExist("server/services/exceptionIntelligence/callPriorityService.ts");
mustExist("server/routes/callPriority.ts");
mustExist("client/src/lib/callPriorityApi.ts");
mustExist("client/src/pages/call-priority.tsx");
mustExist("docs/architecture/phase-3-call-priority-intelligence.md");

if (failures.length) {
  console.error("[qa-phase-3-call-priority-intelligence] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

const engine = read("server/services/exceptionIntelligence/exceptionSnapshotEngine.ts");
const rules = read("server/services/exceptionIntelligence/recommendationRules.ts");

// 1) Engine version bumped to PR 3.7
if (!/DETECTOR_VERSION\s*=\s*"3\.7\.0"/.test(engine)) {
  fail("DETECTOR_VERSION must be bumped to 3.7.0");
}

// 2) Engine registers the 4 new detector functions
for (const fn of [
  "detectMissingPatientContact", "detectCallOutcomeOverdue",
  "detectUnableToReachThreshold",
]) {
  if (!new RegExp(`async function ${fn}\\b`).test(engine)) fail(`engine missing detector function: ${fn}`);
}

// 3) Engine extends supersede whitelist with the 4 new types
for (const t of [
  "missing_patient_contact", "lvm_followup_overdue",
  "no_answer_followup_overdue", "unable_to_reach_threshold_met",
]) {
  if (!engine.includes(`"${t}"`)) fail(`engine must include "${t}" in supersede whitelist`);
}

// 4) Recommendation rules cover the 4 new types
for (const t of [
  "missing_patient_contact", "lvm_followup_overdue",
  "no_answer_followup_overdue", "unable_to_reach_threshold_met",
]) {
  if (!new RegExp(`${t}:\\s*\\w`).test(rules)) fail(`recommendation rule missing for: ${t}`);
}

// 5) Call priority service is deterministic and rule-based
const svc = read("server/services/exceptionIntelligence/callPriorityService.ts");
if (/Math\.random/.test(svc)) fail("call priority must be deterministic — no Math.random");
if (!/items\.sort\(\(a, b\) => b\.score - a\.score\)/.test(svc)) {
  fail("call priority must sort by descending score");
}
if (!/CALL_PRIORITY_VERSION\s*=\s*"3\.7\.0"/.test(svc)) {
  fail("call priority must declare version 3.7.0");
}

// 6) Service does not mutate state
if (/db\.update|db\.insert|db\.delete/.test(svc)) {
  fail("call priority service must be read-only");
}

// 7) Route is authenticated
const routes = read("server/routes/callPriority.ts");
if (!/app\.get\(\s*"\/api\/call-priority"\s*,\s*requireAuth/.test(routes)) {
  fail("GET /api/call-priority must require auth");
}

// 8) Page has expected data-testids
const page = read("client/src/pages/call-priority.tsx");
for (const ds of [
  "call-priority-page", "call-priority-table", "call-priority-row-",
  "call-priority-facility-input", "call-priority-owner-input",
  "call-priority-score-",
]) {
  if (!page.includes(ds)) fail(`call priority page missing data-testid prefix: ${ds}`);
}
if (/automaticallyDial|autoCall|placeCall\(/.test(page)) {
  fail("call priority page must not advertise automatic dialing");
}

// 9) RECOMMENDATION_VERSION bumped to 3.7.0
if (!/RECOMMENDATION_VERSION\s*=\s*"3\.7\.0"/.test(rules)) {
  fail("RECOMMENDATION_VERSION must be bumped to 3.7.0");
}

if (failures.length) {
  console.error("[qa-phase-3-call-priority-intelligence] FAIL");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("[qa-phase-3-call-priority-intelligence] PASS");
