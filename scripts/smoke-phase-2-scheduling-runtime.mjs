// Smoke — Phase 2 scheduling runtime hardening.
//
// Run: node scripts/smoke-phase-2-scheduling-runtime.mjs

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

check(
  "1. scheduleStatusService exports applyScheduleTransition",
  "server/services/scheduling/scheduleStatusService.ts",
  (s) => s.includes("export async function applyScheduleTransition"),
);
check(
  "2. Transitions covered: cancel, reschedule, no_show, confirm",
  "server/services/scheduling/scheduleStatusService.ts",
  (s) =>
    s.includes('"cancel"') &&
    s.includes('"reschedule"') &&
    s.includes('"no_show"') &&
    s.includes('"confirm"'),
);
check(
  "3. Reschedule requires newStartsAt",
  "server/services/scheduling/scheduleStatusService.ts",
  (s) => /reschedule requires newStartsAt/.test(s),
);
check(
  "4. Illegal transition → 409",
  "server/services/scheduling/scheduleStatusService.ts",
  (s) => /status:\s*409/.test(s),
);
check(
  "5. Execution case reflects cancel/no-show/reschedule",
  "server/services/scheduling/scheduleStatusService.ts",
  (s) =>
    /scheduling_needed/.test(s) &&
    /needs_followup/.test(s) &&
    /engagementStatus:\s*"scheduled"/.test(s),
);
check(
  "6. Transition route registered",
  "server/routes/globalSchedule.ts",
  (s) => s.includes('"/api/global-schedule-events/:id/transition"'),
);
check(
  "7. Client posts to the canonical transition route",
  "client/src/lib/portal/scheduleTransitionApi.ts",
  (s) => /\/api\/global-schedule-events\/\$\{input\.eventId\}\/transition/.test(s),
);
check(
  "8. Client invalidates workspace schedule queries on success",
  "client/src/lib/portal/scheduleTransitionApi.ts",
  (s) => s.includes("invalidateTeamPortalScheduleQueries"),
);
check(
  "9. Journey event catalogue includes 4 new types",
  "shared/contracts/journeyEvents.ts",
  (s) =>
    s.includes('"schedule_cancelled"') &&
    s.includes('"schedule_rescheduled"') &&
    s.includes('"schedule_no_show"') &&
    s.includes('"schedule_confirmed"'),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: scheduling runtime hardened.");
