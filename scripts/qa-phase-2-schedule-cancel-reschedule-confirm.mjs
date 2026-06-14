// QA — Phase 2 PR 2.4 schedule transitions: cancel / reschedule /
// no-show / confirm wired to the canonical writer.
//
// Run: node scripts/qa-phase-2-schedule-cancel-reschedule-confirm.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const service = fs.readFileSync(
  path.join(root, "server/services/scheduling/scheduleStatusService.ts"),
  "utf8",
);

if (!service.includes("export async function applyScheduleTransition")) {
  failures.push("scheduleStatusService must export applyScheduleTransition");
}
const REQUIRED_TRANSITIONS = ["cancel", "reschedule", "no_show", "confirm"];
for (const t of REQUIRED_TRANSITIONS) {
  if (!service.includes(`"${t}"`)) {
    failures.push(`scheduleStatusService must support transition "${t}"`);
  }
}
const REQUIRED_STATUSES = ["cancelled", "rescheduled", "no_show", "confirmed"];
for (const s of REQUIRED_STATUSES) {
  if (!service.includes(`"${s}"`)) {
    failures.push(`scheduleStatusService must emit status "${s}"`);
  }
}
// Validates the from-status before transitioning.
if (!service.includes("VALID_TRANSITIONS")) {
  failures.push("scheduleStatusService must pin allowed transitions per from-status");
}
// 409 on illegal transition.
if (!service.includes("status: 409")) {
  failures.push("scheduleStatusService must reject illegal transitions with 409");
}

const route = fs.readFileSync(path.join(root, "server/routes/globalSchedule.ts"), "utf8");
if (!route.includes('"/api/global-schedule-events/:id/transition"')) {
  failures.push("globalSchedule.ts must register POST /api/global-schedule-events/:id/transition");
}
if (!route.includes("applyScheduleTransition")) {
  failures.push("transition route must delegate to applyScheduleTransition");
}

// Journey event catalogue includes the 4 new event types.
const catalogue = fs.readFileSync(path.join(root, "shared/contracts/journeyEvents.ts"), "utf8");
const REQUIRED_EVENT_TYPES = [
  "schedule_cancelled",
  "schedule_rescheduled",
  "schedule_no_show",
  "schedule_confirmed",
];
for (const e of REQUIRED_EVENT_TYPES) {
  if (!catalogue.includes(`"${e}"`)) {
    failures.push(`PATIENT_JOURNEY_EVENT_TYPES must include "${e}"`);
  }
}

// Client helper exposes the canonical API.
const client = fs.readFileSync(
  path.join(root, "client/src/lib/portal/scheduleTransitionApi.ts"),
  "utf8",
);
if (!client.includes("postScheduleTransition") || !client.includes("postScheduleTransitionAndInvalidate")) {
  failures.push("client scheduleTransitionApi must export both post helpers");
}
if (!client.includes("invalidateTeamPortalScheduleQueries")) {
  failures.push("scheduleTransitionApi must invalidate workspace schedule queries on success");
}

if (failures.length > 0) {
  console.error("Phase-2 schedule-cancel-reschedule-confirm QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase-2 schedule-cancel-reschedule-confirm QA passed.");
