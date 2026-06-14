// QA — Phase 2 call-result settings routing.
//
// The call-result route must:
//   - Load the effective settings bundle.
//   - Apply the routing plan.
//   - Write the routing plan + applied settings + audit identity
//     into the journey event metadata.
//
// Run: node scripts/qa-phase-2-call-result-settings-routing.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const route = fs.readFileSync(path.join(root, "server/routes/executionCases.ts"), "utf8");

const REQUIRED_IMPORTS = [
  "applyCallResultRouting",
  "getEffectiveAdminSettings",
  "resolveCallResultAuditIdentity",
  "callResultAuditMetadata",
];
for (const i of REQUIRED_IMPORTS) {
  if (!route.includes(i)) {
    failures.push(`executionCases.ts must import ${i}`);
  }
}

// Load bundle BEFORE computing journey metadata so the plan can
// be written into it.
if (!/const effectiveBundle = await getEffectiveAdminSettings/.test(route)) {
  failures.push("call-result handler must call getEffectiveAdminSettings");
}
if (!/const routingPlan = applyCallResultRouting/.test(route)) {
  failures.push("call-result handler must call applyCallResultRouting");
}
// Journey metadata must carry the routing plan + applied settings.
if (!/routing_plan:\s*\{/.test(route) || !/applied_settings:/.test(route)) {
  failures.push("journey metadata must include routing_plan.applied_settings");
}

const planService = fs.readFileSync(
  path.join(root, "server/services/callResult/applyCallResultRouting.ts"),
  "utf8",
);
// Plan respects DNC / declined / scheduled / ready_to_schedule via
// admin settings.
const REQUIRED_DECISIONS = [
  'input.outcome === "dnc"',
  'input.outcome === "declined"',
  'input.outcome === "scheduled"',
  'input.outcome === "ready_to_schedule"',
];
for (const d of REQUIRED_DECISIONS) {
  if (!planService.includes(d)) {
    failures.push(`applyCallResultRouting must branch on ${d}`);
  }
}
// Plan reads each interval from cr.<field>.
const INTERVALS = ["callbackDueHours", "noAnswerCallbackHours", "voicemailCallbackHours"];
for (const i of INTERVALS) {
  if (!planService.includes(`cr.${i}`)) {
    failures.push(`applyCallResultRouting must read cr.${i}`);
  }
}
// Unable-to-reach transition computed.
if (!/shouldTransitionToUnableToReach/.test(planService)) {
  failures.push("plan must compute shouldTransitionToUnableToReach");
}

if (failures.length > 0) {
  console.error("Phase-2 call-result-settings-routing QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 call-result-settings-routing QA passed.");
