// MC-DATA-001 — per-field Mission Control metric honesty contract.
//
// Behavioral tests for buildMissionControlSpine with an INJECTED fake repo
// (no database). Locks the per-field contract:
//
//   TEST 1  real zero          → { value: 0, sourceMissing: false }
//   TEST 2  missing source     → { value: null, sourceMissing: true }
//   TEST 3  live sibling survives (one live + one missing in same family)
//   TEST 4  no fake zero        → not-wired metrics serialize value: null (never 0)
//   TEST 5  no regression       → live spine/section metrics keep numeric values
//   TEST 6  no section-level sourceMissing field remains on any section
//
// Runnable via: npx tsx tests/unit/missionControlMetricContract.test.ts

import {
  buildMissionControlSpine,
  type MissionRepoDeps,
} from "../../server/services/missionControl/missionControlService";

type MetricValue<T> = { available: true; value: T } | { available: false; reason: string };
const AVAILABLE = (value: number): MetricValue<number> => ({ available: true, value });
const UNAVAILABLE = (reason: string): MetricValue<number> => ({ available: false, reason });

// Fake repo: prescreen + scheduledToday deliberately return a REAL 0;
// upcomingAncillary is UNAVAILABLE; everything else returns a nonzero count.
const fakeRepo: MissionRepoDeps = {
  countActiveExecutionCases_platformWide: async () => AVAILABLE(7),
  countCallbacksPending_platformWide: async () => AVAILABLE(3),
  countOpenPlexusTasks_platformWide: async () => AVAILABLE(2),
  countPrescreenPending_platformWide: async () => AVAILABLE(0), // real zero
  countReadyForBilling_platformWide: async () => AVAILABLE(5),
  countReportsMissing_platformWide: async () => AVAILABLE(0), // real zero
  countRunningAnalysisJobs_platformWide: async () => AVAILABLE(1),
  countScheduledInWindow_platformWide: async () => AVAILABLE(0), // real zero
  countUpcomingAncillaryPatients_UNAVAILABLE: async () =>
    UNAVAILABLE("no dedupe helper yet"),
};

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error(`- ${msg}`);
  }
};

async function run() {
  const now = new Date("2026-09-14T12:00:00.000Z");
  const data = await buildMissionControlSpine({ now, repo: fakeRepo });
  const { spine, sections } = data;

  // TEST 1 — real zero: query-backed 0 is live, not missing.
  check(
    spine.prescreen.value === 0 && spine.prescreen.sourceMissing === false,
    `TEST1 spine.prescreen should be {0,false}, got ${JSON.stringify(spine.prescreen)}`,
  );
  check(
    sections.ancillaryToday.scheduledToday.value === 0 &&
      sections.ancillaryToday.scheduledToday.sourceMissing === false,
    `TEST1 scheduledToday should be {0,false}, got ${JSON.stringify(sections.ancillaryToday.scheduledToday)}`,
  );
  check(
    spine.noReport.value === 0 && spine.noReport.sourceMissing === false,
    `TEST1 spine.noReport should be {0,false}, got ${JSON.stringify(spine.noReport)}`,
  );

  // TEST 2 — missing source: value null + sourceMissing true.
  check(
    spine.readyToCall.value === null && spine.readyToCall.sourceMissing === true,
    `TEST2 spine.readyToCall should be {null,true}, got ${JSON.stringify(spine.readyToCall)}`,
  );
  check(
    spine.pending.value === null && spine.pending.sourceMissing === true,
    `TEST2 spine.pending (upcoming ancillary UNAVAILABLE) should be {null,true}, got ${JSON.stringify(spine.pending)}`,
  );

  // TEST 3 — live sibling survives: within patientServices, inPipeline +
  // prescreenBacklog are live even though pendingAncillary + declinedLast7
  // are unavailable. The old section-level flag would have blanked all four.
  check(
    sections.patientServices.inPipeline.value === 7 &&
      sections.patientServices.inPipeline.sourceMissing === false,
    `TEST3 inPipeline should stay live {7,false}, got ${JSON.stringify(sections.patientServices.inPipeline)}`,
  );
  check(
    sections.patientServices.prescreenBacklog.value === 0 &&
      sections.patientServices.prescreenBacklog.sourceMissing === false,
    `TEST3 prescreenBacklog should stay live {0,false}, got ${JSON.stringify(sections.patientServices.prescreenBacklog)}`,
  );
  check(
    sections.patientServices.pendingAncillary.sourceMissing === true,
    `TEST3 pendingAncillary should be missing while siblings live`,
  );
  // operations: tasksOpen live while overdue/high missing.
  check(
    sections.operations.tasksOpen.value === 2 &&
      sections.operations.tasksOpen.sourceMissing === false,
    `TEST3 tasksOpen should stay live {2,false}, got ${JSON.stringify(sections.operations.tasksOpen)}`,
  );
  // finance: billingReady live while paid/outstanding missing.
  check(
    sections.finance.billingReady.value === 5 &&
      sections.finance.billingReady.sourceMissing === false,
    `TEST3 billingReady should stay live {5,false}, got ${JSON.stringify(sections.finance.billingReady)}`,
  );

  // TEST 4 — no fake zero: not-wired metrics are null, NEVER 0.
  const notWired: [string, { value: number | null; sourceMissing: boolean }][] = [
    ["calls.madeToday", sections.calls.madeToday],
    ["calls.reachedToday", sections.calls.reachedToday],
    ["calls.madeLast7", sections.calls.madeLast7],
    ["ancillaryToday.completedToday", sections.ancillaryToday.completedToday],
    ["ancillaryToday.cancelledToday", sections.ancillaryToday.cancelledToday],
    ["operations.tasksOverdue", sections.operations.tasksOverdue],
    ["operations.tasksHighPriority", sections.operations.tasksHighPriority],
    ["finance.paidAmount", sections.finance.paidAmount],
    ["finance.outstandingBalance", sections.finance.outstandingBalance],
    ["finance.invoicesSubmitted", sections.finance.invoicesSubmitted],
    ["patientServices.declinedLast7", sections.patientServices.declinedLast7],
  ];
  for (const [name, m] of notWired) {
    check(
      m.value === null && m.sourceMissing === true,
      `TEST4 ${name} must be {null,true} (no fake 0), got ${JSON.stringify(m)}`,
    );
  }

  // TEST 5 — no regression: live counts retain their numeric value.
  check(spine.callbacks.value === 3, `TEST5 spine.callbacks=3, got ${spine.callbacks.value}`);
  check(spine.readyForBilling.value === 5, `TEST5 spine.readyForBilling=5, got ${spine.readyForBilling.value}`);
  check(spine.tasks.value === 2, `TEST5 spine.tasks=2, got ${spine.tasks.value}`);
  check(sections.calls.callbacksPending.value === 3, `TEST5 callbacksPending=3`);

  // TEST 6 — per-field contract: no section-level sourceMissing survives.
  for (const [name, sec] of Object.entries(sections)) {
    check(
      (sec as Record<string, unknown>).sourceMissing === undefined,
      `TEST6 section '${name}' must NOT carry a section-level sourceMissing flag`,
    );
  }

  // Contract shape: every metric carries a key + unit.
  check(
    typeof spine.prescreen.key === "string" && typeof spine.prescreen.unit === "string",
    `TEST6 metrics must carry key + unit`,
  );
  check(
    sections.finance.paidAmount.unit === "currency",
    `TEST6 finance.paidAmount unit should be 'currency', got ${sections.finance.paidAmount.unit}`,
  );

  if (failures > 0) {
    console.error(`missionControlMetricContract.test.ts: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("missionControlMetricContract.test.ts: all tests passed");
}

run().catch((e) => {
  console.error("missionControlMetricContract.test.ts: threw", e);
  process.exit(1);
});
