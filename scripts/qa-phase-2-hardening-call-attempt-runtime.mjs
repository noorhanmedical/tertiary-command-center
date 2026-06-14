// QA — Phase 2 hardening item 1: call-attempt runtime.
//
// Run: node scripts/qa-phase-2-hardening-call-attempt-runtime.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const REQUIRED = [
  "server/services/callResult/callAttemptRuntime.ts",
  "migrations/0032_phase2_call_attempt_hardening.sql",
  "docs/architecture/phase-2-hardening-call-attempt-runtime.md",
  "script/livePhase2CallAttemptProbe.ts",
];
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(root, f))) failures.push(`missing ${f}`);
}

const schema = fs.readFileSync(path.join(root, "shared/schema/executionCase.ts"), "utf8");
const REQUIRED_COLS = [
  'callAttemptCount: integer("call_attempt_count")',
  'lastAttemptAt: timestamp("last_attempt_at")',
  'lastCallOutcome: text("last_call_outcome")',
  'unableToReachAt: timestamp("unable_to_reach_at")',
];
for (const c of REQUIRED_COLS) {
  if (!schema.includes(c)) failures.push(`patientExecutionCases must declare ${c}`);
}
if (!schema.includes('"unable_to_reach"')) {
  failures.push("ENGAGEMENT_STATUSES must include unable_to_reach");
}

const service = fs.readFileSync(path.join(root, "server/services/callResult/callAttemptRuntime.ts"), "utf8");
if (!service.includes("export function planCallAttempt")) {
  failures.push("callAttemptRuntime must export planCallAttempt");
}
const REQUIRED_INC = ["voicemail", "no_answer", "wrong_number", "callback"];
for (const o of REQUIRED_INC) {
  if (!service.includes(`"${o}"`)) failures.push(`ATTEMPT_INCREMENTING_OUTCOMES must include "${o}"`);
}
const REQUIRED_RESET = ["scheduled", "completed", "declined", "dnc"];
for (const o of REQUIRED_RESET) {
  if (!service.includes(`"${o}"`)) failures.push(`ATTEMPT_RESETTING_OUTCOMES must include "${o}"`);
}
if (!/transitionToUnableToReach\s*=\s*counted\s*&&\s*newAttemptCount\s*>=\s*Math\.max\(1, input\.maxCallAttempts\)/.test(service)) {
  failures.push("planCallAttempt must trigger unable_to_reach ONLY when counted AND newAttemptCount >= maxCallAttempts");
}

const route = fs.readFileSync(path.join(root, "server/routes/executionCases.ts"), "utf8");
if (!route.includes("planCallAttempt(")) {
  failures.push("call-result route must invoke planCallAttempt");
}
if (!/updates\.callAttemptCount = attemptPlan\.newAttemptCount/.test(route)) {
  failures.push("call-result route must write callAttemptCount from the plan");
}
if (!/updates\.lastCallOutcome = data\.callResult/.test(route)) {
  failures.push("call-result route must write lastCallOutcome");
}
if (!/attemptPlan\.transitionToUnableToReach/.test(route) || !/engagementStatus:\s*"unable_to_reach"|updates\.engagementStatus = "unable_to_reach"/.test(route)) {
  failures.push("call-result route must transition engagementStatus to unable_to_reach when plan says so");
}
// Journey metadata contract.
if (!/call_attempt:\s*\{/.test(route)) {
  failures.push("call-result route must add a call_attempt block to journey metadata");
}
if (!/previous_attempt_count/.test(route) || !/new_attempt_count/.test(route)) {
  failures.push("journey metadata.call_attempt must include previous_attempt_count + new_attempt_count");
}
if (!/max_call_attempts:\s*attemptPlan\.maxCallAttempts/.test(route)) {
  failures.push("journey metadata.call_attempt must include the max_call_attempts setting actually used");
}

// Audit identity STILL preserved alongside the new attempt fields.
const metadataSpread = (route.match(/\.\.\.callResultAuditMetadata\(auditIdentity\)/g) || []).length;
if (metadataSpread < 2) {
  failures.push("audit identity metadata spread must still appear in both delegation + legacy paths");
}

if (failures.length > 0) {
  console.error("Phase-2 hardening call-attempt-runtime QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 hardening call-attempt-runtime QA passed.");
