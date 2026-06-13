// QA — Admin settings drive callback / LVM / no-answer routing.
//
// The call-result route reads next-action timing from admin settings,
// not hardcoded values. PR C added two new settings:
//   engagement_center.no_answer_callback_hours
//   engagement_center.voicemail_callback_hours
// and kept the pre-existing scheduling_triage.default_callback_due_hours
// for the "callback" outcome.
//
// This QA asserts:
//   1. The settings exist in the seed list.
//   2. The route reads all three.
//   3. The route applies the right setting per outcome.
//   4. The defaults match the canonical planner's defaultCallbackTarget
//      so behaviour is byte-equivalent when the seed has not been
//      customised.
//
// Run: node scripts/qa-admin-settings-drives-callback-routing.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const settings = fs.readFileSync(
  path.join(root, "server/repositories/adminSettings.repo.ts"),
  "utf8",
);

const SEED_REQUIRED = [
  '"engagement_center", settingKey: "no_answer_callback_hours"',
  '"engagement_center", settingKey: "voicemail_callback_hours"',
  '"scheduling_triage", settingKey: "default_callback_due_hours"',
];
for (const s of SEED_REQUIRED) {
  if (!settings.includes(s)) {
    failures.push(`adminSettings.repo seed is missing: ${s}`);
  }
}

const route = fs.readFileSync(
  path.join(root, "server/routes/executionCases.ts"),
  "utf8",
);

// Route reads all three settings.
const ROUTE_READS = [
  'getGlobalAdminSettingValue<{ hours?: number }>("scheduling_triage", "default_callback_due_hours")',
  'getGlobalAdminSettingValue<{ hours?: number }>("engagement_center", "no_answer_callback_hours")',
  'getGlobalAdminSettingValue<{ hours?: number }>("engagement_center", "voicemail_callback_hours")',
];
for (const r of ROUTE_READS) {
  if (!route.includes(r)) {
    failures.push(`call-result route must read ${r}`);
  }
}

// Route applies the right setting per outcome.
const OUTCOME_APPLICATIONS = [
  // callback uses callbackHours
  /if \(data\.callResult === "callback" \|\| data\.callResult === "patient_requested_call_later"\) \{\s+hours = callbackHours;/,
  // no_answer uses noAnswerCallbackHours
  /else if \(data\.callResult === "no_answer"\) \{\s+hours = noAnswerCallbackHours;/,
  // voicemail uses voicemailCallbackHours
  /else if \(data\.callResult === "voicemail"\) \{\s+hours = voicemailCallbackHours;/,
];
for (const rx of OUTCOME_APPLICATIONS) {
  if (!rx.test(route)) {
    failures.push(`call-result route must apply admin-settings hours per outcome — pattern not found: ${rx.source.slice(0, 80)}…`);
  }
}

// Defaults match the canonical planner (4h for no-answer + voicemail,
// 24h for callback — matches the legacy task-spec default).
if (!/noAnswerCallbackHours = typeof noAnswerSetting\?\.hours === "number" \? noAnswerSetting\.hours : 4/.test(route)) {
  failures.push("noAnswerCallbackHours default must be 4 hours");
}
if (!/voicemailCallbackHours = typeof voicemailSetting\?\.hours === "number" \? voicemailSetting\.hours : 4/.test(route)) {
  failures.push("voicemailCallbackHours default must be 4 hours");
}
if (!/callbackHours = typeof callbackSetting\?\.hours === "number" \? callbackSetting\.hours : 24/.test(route)) {
  failures.push("callbackHours default must be 24 hours (matches scheduling_triage default)");
}

if (failures.length > 0) {
  console.error("Admin-settings-drives-callback-routing QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Admin-settings-drives-callback-routing QA passed.");
