// QA — When a team-portal user schedules an ancillary appointment,
// the new row must appear in the Ancillary Schedule mode of the
// right-panel mode-switcher WITHOUT a manual page refresh.
//
// The contract:
//   - Scheduling writes go through POST /api/global-schedule-events/schedule-ancillary
//     (the single canonical writer).
//   - On success, the client calls invalidateTeamPortalScheduleQueries
//     which invalidates "team-workspace-ancillary-schedule".
//   - The right-panel ancillary mode reads from a query keyed on
//     "team-workspace-ancillary-schedule".
//
// Run: node scripts/qa-scheduling-appears-in-ancillary-schedule.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

// 1. The invalidations helper exists and invalidates the ancillary key.
const helper = fs.readFileSync(
  path.join(root, "client/src/lib/portal/scheduleInvalidations.ts"),
  "utf8",
);
if (!helper.includes("invalidateTeamPortalScheduleQueries")) {
  failures.push("scheduleInvalidations.ts must export invalidateTeamPortalScheduleQueries");
}
if (!helper.includes('queryKey: ["team-workspace-ancillary-schedule"]')) {
  failures.push("invalidateTeamPortalScheduleQueries must invalidate the team-workspace-ancillary-schedule key");
}
if (!helper.includes('queryKey: ["team-workspace-clinic-schedule"]')) {
  failures.push("invalidateTeamPortalScheduleQueries must invalidate the team-workspace-clinic-schedule key (clinic visits)");
}
if (!helper.includes('queryKey: ["team-workspace-call-list"]')) {
  failures.push("invalidateTeamPortalScheduleQueries must invalidate the team-workspace-call-list key (the scheduled patient leaves the call list)");
}

// 2. Both portal scheduling entry points use the helper.
const SCHEDULING_CONSUMERS = [
  "client/src/components/portal/SchedulePatientDialog.tsx",
  "client/src/components/portal/SchedulePatientPlayground.tsx",
];
for (const f of SCHEDULING_CONSUMERS) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  if (!src.includes("invalidateTeamPortalScheduleQueries")) {
    failures.push(`${f} must call invalidateTeamPortalScheduleQueries after a successful schedule write`);
  }
  if (!src.includes("/api/global-schedule-events/schedule-ancillary")) {
    failures.push(`${f} must POST to /api/global-schedule-events/schedule-ancillary (the single canonical writer)`);
  }
}

// 3. The shell mounts the ancillary mode and queries the right key.
const shell = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);
if (!shell.includes('"team-workspace-ancillary-schedule"')) {
  failures.push("TeamPortalShell must use the team-workspace-ancillary-schedule query key");
}
if (!shell.includes("fetchWorkspaceAncillarySchedule")) {
  failures.push("TeamPortalShell must call fetchWorkspaceAncillarySchedule (the canonical /api/technician-liaison/ancillary-schedule reader)");
}

// 4. The server's schedule-ancillary route writes a real
//    global_schedule_events row of type ancillary_appointment.
const route = fs.readFileSync(
  path.join(root, "server/routes/globalSchedule.ts"),
  "utf8",
);
if (!route.includes('"/api/global-schedule-events/schedule-ancillary"')) {
  failures.push("globalSchedule.ts must register POST /api/global-schedule-events/schedule-ancillary");
}
if (!route.includes("ancillary_appointment")) {
  failures.push("globalSchedule.ts schedule-ancillary handler must write an event of type ancillary_appointment");
}

if (failures.length > 0) {
  console.error("Scheduling-appears-in-Ancillary-Schedule QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Scheduling-appears-in-Ancillary-Schedule QA passed.");
