// Smoke — End-to-end shape check for the phone-call result lifecycle.
//
// Walks the canonical chain from "operator logs a call result" to
// "the right queue refreshes with the right state":
//
//   1. Outcome → planner side-effect envelope (PLAN_BY_OUTCOME).
//   2. Callback-style outcomes set next-action-at (admin-settings-driven).
//   3. Route writes the call + journey event + (when applicable) the
//      triage case AND the engagement-case engagementStatus.
//   4. Client invalidation refreshes the workspace call list.
//   5. RingCentral remains dormant (no fake live calls).
//
// Run: node scripts/smoke-phone-call-result-lifecycle.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — failed for ${file}`);
}

// 1. Planner: canonical outcomes + plans pinned.
check(
  "1. Canonical planner exports CALL_RESULT_OUTCOMES",
  "server/services/callResult/recordCallResult.ts",
  (s) => s.includes("export const CALL_RESULT_OUTCOMES"),
);
check(
  "2. Planner maps scheduled → terminal + assignmentCompleted",
  "server/services/callResult/recordCallResult.ts",
  (s) => /scheduled: \{[\s\S]*?assignmentCompleted: true[\s\S]*?terminal: true/.test(s),
);
check(
  "3. Planner maps voicemail (LVM) → non-terminal + triage required",
  "server/services/callResult/recordCallResult.ts",
  (s) => /voicemail: \{[\s\S]*?triageCaseRequired: true[\s\S]*?terminal: false/.test(s),
);
check(
  "4. Planner maps no_answer → non-terminal + triage required",
  "server/services/callResult/recordCallResult.ts",
  (s) => /no_answer: \{[\s\S]*?triageCaseRequired: true[\s\S]*?terminal: false/.test(s),
);

// 5. Admin settings drive callback / LVM / no-answer interval.
check(
  "5. Route reads engagement_center.no_answer_callback_hours",
  "server/routes/executionCases.ts",
  (s) => s.includes('getGlobalAdminSettingValue<{ hours?: number }>("engagement_center", "no_answer_callback_hours")'),
);
check(
  "6. Route reads engagement_center.voicemail_callback_hours",
  "server/routes/executionCases.ts",
  (s) => s.includes('getGlobalAdminSettingValue<{ hours?: number }>("engagement_center", "voicemail_callback_hours")'),
);
check(
  "7. Route reads scheduling_triage.default_callback_due_hours",
  "server/routes/executionCases.ts",
  (s) => s.includes('getGlobalAdminSettingValue<{ hours?: number }>("scheduling_triage", "default_callback_due_hours")'),
);

// 8. Route applies the right interval per outcome.
check(
  "8. Route applies admin-settings hours per outcome (callback/no_answer/voicemail)",
  "server/routes/executionCases.ts",
  (s) =>
    /hours = callbackHours/.test(s) &&
    /hours = noAnswerCallbackHours/.test(s) &&
    /hours = voicemailCallbackHours/.test(s),
);

// 9. Route appends a journey event for every call result.
check(
  "9. Route appends a call_result_logged journey event",
  "server/services/callResult/recordCallResult.ts",
  (s) => s.includes('journeyEventType: "call_result_logged"'),
);

// 10. DispositionSheet invalidates the workspace call list.
check(
  "10. DispositionSheet invalidates the team-workspace-call-list predicate (twice — both mutations)",
  "client/src/components/outreach/DispositionSheet.tsx",
  (s) => {
    const matches = s.match(/q\.queryKey\[0\] === "team-workspace-call-list"/g) || [];
    return matches.length >= 2;
  },
);

// 11. Scheduling write goes through the canonical writer + invalidates
//     the workspace ancillary schedule.
check(
  "11. SchedulePatientDialog uses canonical writer + invalidations helper",
  "client/src/components/portal/SchedulePatientDialog.tsx",
  (s) =>
    s.includes("/api/global-schedule-events/schedule-ancillary") &&
    s.includes("invalidateTeamPortalScheduleQueries"),
);

// 12. RingCentral dormant.
check(
  "12. RingCentral adapter remains gated by isRingCentralAdapterEnabled",
  "server/services/ringCentral/ringCentralAdapter.ts",
  (s) => s.includes("isRingCentralAdapterEnabled"),
);

// 13. ACS live surfaces (consent + uploads) wired.
check(
  "13. /api/portal/sign-consent is wired (consent signing live)",
  "server/routes/portal.ts",
  (s) => s.includes('app.post("/api/portal/sign-consent"'),
);
check(
  "14. /api/portal/uploads is wired (report + screening + document upload live)",
  "server/routes/portal.ts",
  (s) => s.includes('app.post("/api/portal/uploads"'),
);

// 15. Both portals continue to expose Call List + Ancillary Schedule
//     (the mode contract pinned by PR A).
check(
  "15. WorkspaceModeSwitcher still exposes all 3 modes",
  "client/src/components/portal/WorkspaceModeSwitcher.tsx",
  (s) =>
    s.includes('"clinicSchedule"') &&
    s.includes('"ancillarySchedule"') &&
    s.includes('"callList"'),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: phone-call result lifecycle intact.");
