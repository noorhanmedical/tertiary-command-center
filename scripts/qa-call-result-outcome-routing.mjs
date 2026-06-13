// QA — Call-result outcome routing contract.
//
// Each canonical outcome must map to the correct downstream
// side-effect envelope in server/services/callResult/recordCallResult.ts.
// This QA pins the contract so a future refactor cannot silently
// re-route LVM → terminal, or declined → callback, or any other
// outcome → wrong queue.
//
// Run: node scripts/qa-call-result-outcome-routing.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "server/services/callResult/recordCallResult.ts"),
  "utf8",
);

// 1. The 14 canonical outcomes are all present in CALL_RESULT_OUTCOMES.
const REQUIRED_OUTCOMES = [
  "scheduled", "callback", "no_answer", "voicemail", "wrong_number",
  "declined", "needs_records", "insurance_prior_auth_issue",
  "manager_review", "facility_specific_issue",
  "completed", "dnc", "do_not_contact", "deceased", "cancelled",
];
for (const o of REQUIRED_OUTCOMES) {
  if (!src.includes(`"${o}"`)) {
    failures.push(`CALL_RESULT_OUTCOMES is missing canonical outcome "${o}"`);
  }
}

// 2. Outcome → plan invariants. We grep for the literal plan block
//    so a re-order doesn't slip past type-checking.
function planBlock(label) {
  const open = src.indexOf(`${label}: {`);
  if (open < 0) return null;
  const close = src.indexOf("},", open);
  return src.slice(open, close);
}

function plansRequire(label, requirements) {
  const block = planBlock(label);
  if (!block) {
    failures.push(`PLAN_BY_OUTCOME is missing a "${label}" block`);
    return;
  }
  for (const r of requirements) {
    if (!block.includes(r)) {
      failures.push(`PLAN_BY_OUTCOME["${label}"] must include ${r}`);
    }
  }
}

// Terminal "scheduled" — appointment + closed, no triage, no task.
plansRequire("scheduled", [
  'appointmentStatus: "scheduled"',
  "assignmentCompleted: true",
  "triageCaseRequired: false",
  "followUpTaskRequired: false",
  "terminal: true",
]);

// Non-terminal "callback" — patient asked to be called back later.
plansRequire("callback", [
  'appointmentStatus: "callback"',
  "assignmentCompleted: false",
  "triageCaseRequired: true",
  'triageType: "callback_scheduled"',
  "terminal: false",
]);

// Non-terminal "no_answer" — re-queue back onto call list.
plansRequire("no_answer", [
  'appointmentStatus: "no_answer"',
  'executionCaseEngagementStatus: "not_reached"',
  "triageCaseRequired: true",
  'triageType: "no_answer"',
  "terminal: false",
]);

// Non-terminal "voicemail" / LVM — re-queue back onto call list.
plansRequire("voicemail", [
  'appointmentStatus: "no_answer"',
  'executionCaseEngagementStatus: "not_reached"',
  "triageCaseRequired: true",
  'triageType: "voicemail"',
  "terminal: false",
]);

// Terminal "declined" — patient said no; close the assignment.
plansRequire("declined", [
  'appointmentStatus: "declined"',
  "assignmentCompleted: true",
  "triageCaseRequired: false",
  "terminal: true",
]);

// Terminal "dnc" — Do Not Contact (terminal-positive close).
plansRequire("dnc", [
  'appointmentStatus: "declined"',
  "assignmentCompleted: true",
  "terminal: true",
]);

// 3. CALLBACK_STYLE_OUTCOMES — exactly callback / no_answer / voicemail.
const cbBlock = src.slice(
  src.indexOf("CALLBACK_STYLE_OUTCOMES"),
  src.indexOf("]);", src.indexOf("CALLBACK_STYLE_OUTCOMES")) + 3,
);
const CALLBACK_REQUIRED = ["callback", "no_answer", "voicemail"];
for (const o of CALLBACK_REQUIRED) {
  if (!cbBlock.includes(`"${o}"`)) {
    failures.push(`CALLBACK_STYLE_OUTCOMES must include "${o}" — without it the next-action timer is not set`);
  }
}
// Terminal outcomes must NOT be in CALLBACK_STYLE_OUTCOMES.
const TERMINAL_FORBIDDEN_IN_CALLBACK = ["scheduled", "declined", "dnc", "do_not_contact", "deceased", "cancelled", "completed"];
for (const o of TERMINAL_FORBIDDEN_IN_CALLBACK) {
  if (cbBlock.includes(`"${o}"`)) {
    failures.push(`CALLBACK_STYLE_OUTCOMES must NOT include terminal outcome "${o}"`);
  }
}

if (failures.length > 0) {
  console.error("Call-result outcome routing QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Call-result outcome routing QA passed.");
