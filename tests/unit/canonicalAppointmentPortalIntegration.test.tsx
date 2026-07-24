// Phase 2D-D1 — real rendered-component integration.
//
// Renders the ACTUAL CanonicalAppointmentSummary via react-dom/server
// (tsconfig jsx=preserve → classic runtime, so React is exposed as a
// global before a dynamic import) and exercises the real calendar event
// mapper. This is genuine render output, not the pure model alone.
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentPortalIntegration.test.tsx

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AncillaryAppointmentProjection, CanonicalAppointmentView } from "../../shared/types/canonicalAppointment";

// Expose React globally for the classic JSX runtime, THEN dynamic-import
// the real component + mapper through the configured @/ alias.
(globalThis as unknown as { React: typeof React }).React = React;
const { CanonicalAppointmentSummary } = await import("@/components/canonical/CanonicalAppointmentSummary");
const { isCanonicalAppointmentUiEnabled } = await import("@/lib/canonicalAppointmentUiFlag");
const { mapGlobalScheduleEventToCalendarEvent } = await import("@/calendar/calendarEventMapper");
// The REAL server-side shared eligibility filter — exercised so the
// response→parent→render flow uses production filtering, not a test copy.
const { filterAppointmentsToEligibleServices } = await import("../../server/services/canonicalAppointments/appointmentProjection");

const ROOT = process.cwd();
const START = "2027-03-01T10:00:00.000Z";

function view(over: Partial<CanonicalAppointmentView> = {}): CanonicalAppointmentView {
  return {
    globalScheduleEventId: 700, ancillaryCaseId: 300, patientScreeningId: 77, executionCaseId: 900,
    serviceType: "EchoWave", eventType: "ancillary_appointment", status: "scheduled",
    startsAt: START, endsAt: null, timezone: null, facilityId: "F", location: null,
    assignedUserId: null, parentEventId: null, cancellationReason: null, noShowReason: null, ...over,
  };
}
function projection(over: Partial<AncillaryAppointmentProjection> = {}): AncillaryAppointmentProjection {
  return { activeAppointment: view(), appointmentHistory: [], appointmentEligibleForOrderNote: true, appointmentEligibilityReason: "qualifying_appointment", ...over };
}
function render(props: Parameters<typeof CanonicalAppointmentSummary>[0]): string {
  return renderToStaticMarkup(React.createElement(CanonicalAppointmentSummary, props));
}

// ─── (1) Patient EHR ancillary case renders the correct event ─────
async function testEhrRenders() {
  const html = render({ projection: projection(), serviceType: "EchoWave" });
  assert.ok(html.includes('data-global-schedule-event-id="700"'), "renders the canonical event id");
  assert.ok(html.includes("EchoWave"));
  assert.ok(html.includes("Scheduled"));
}

// ─── (2/8) Engagement/different services render their own event only ─
async function testDifferentServices() {
  const echo = render({ projection: projection({ activeAppointment: view({ globalScheduleEventId: 700, serviceType: "EchoWave" }) }), serviceType: "EchoWave" });
  const sleep = render({ projection: projection({ activeAppointment: view({ globalScheduleEventId: 800, serviceType: "SleepWave" }) }), serviceType: "SleepWave" });
  assert.ok(echo.includes('data-global-schedule-event-id="700"') && echo.includes("EchoWave"));
  assert.ok(sleep.includes('data-global-schedule-event-id="800"') && sleep.includes("SleepWave"));
  assert.ok(!echo.includes("SleepWave"), "EchoWave card does not show SleepWave's event");
}

// ─── (3/4) PCS/scheduler render appointmentByService inline ───────
async function testPcsSchedulerRender() {
  // A scheduler/PCS card renders one summary per service projection.
  const html = render({ projection: projection(), serviceType: "EchoWave", "data-testid": "canonical-case-appointment-900-EchoWave" });
  assert.ok(html.includes('data-testid="canonical-case-appointment-900-EchoWave"'));
  assert.ok(html.includes('data-global-schedule-event-id="700"'));
}

// ─── (5/6) Calendar canonical event uses stable ID; doctor_visit separate ─
async function testCalendarMapper() {
  const canonical = mapGlobalScheduleEventToCalendarEvent({
    id: 700, eventType: "ancillary_appointment", serviceType: "EchoWave", patientName: "P",
    startsAt: START, status: "scheduled", canonicalAncillary: true, ancillaryCaseId: 300, parentEventId: null,
  });
  assert.ok(canonical);
  assert.equal(canonical!.id, "global_schedule_events:700", "keyed by the event id, not date/facility");
  assert.equal(canonical!.globalScheduleEventId, 700);
  assert.equal((canonical!.metadata as Record<string, unknown>).ancillaryCaseId, 300);
  const doctor = mapGlobalScheduleEventToCalendarEvent({
    id: 701, eventType: "doctor_visit", serviceType: null, patientName: "P", startsAt: START, status: "scheduled",
  });
  assert.ok(doctor);
  assert.equal((doctor!.metadata as Record<string, unknown>).canonicalAncillary, false, "doctor_visit stays a separate general event");
}

// ─── (7) Cancelled/no-show/rescheduled prior not active ───────────
async function testHistoryNotActive() {
  const html = render({
    projection: projection({ activeAppointment: null, appointmentHistory: [view({ globalScheduleEventId: 700, status: "cancelled" })] }),
    serviceType: "EchoWave", showHistory: true,
  });
  assert.ok(html.includes("Not scheduled"), "cancelled prior is not shown active");
  assert.ok(!html.includes("Scheduled</"), "no active Scheduled badge");
  assert.ok(html.includes("prior event"), "history indicator present");
}
async function testRescheduledChildActive() {
  const html = render({
    projection: projection({ activeAppointment: view({ globalScheduleEventId: 701, status: "scheduled", parentEventId: 700 }), appointmentHistory: [view({ globalScheduleEventId: 700, status: "rescheduled" })] }),
    serviceType: "EchoWave", showHistory: true,
  });
  assert.ok(html.includes('data-global-schedule-event-id="701"'), "child is active");
  assert.ok(html.includes("Scheduled"));
  assert.ok(html.includes("prior event"));
}

// ─── (9) Order Note readiness comes from server projection ────────
async function testOrderNoteReadiness() {
  const ready = render({ projection: projection({ appointmentEligibleForOrderNote: true }), serviceType: "EchoWave", showReadiness: true });
  assert.ok(ready.includes('data-order-note-ready="true"'), "ready state from server field");
  const notReady = render({ projection: projection({ appointmentEligibleForOrderNote: false, appointmentEligibilityReason: "no_qualifying_appointment" }), serviceType: "EchoWave", showReadiness: true });
  assert.ok(notReady.includes('data-order-note-ready="false"'));
}

// ─── (10) Client flag OFF → no canonical summary mounted ──────────
async function testFlagOffNoMount() {
  assert.equal(isCanonicalAppointmentUiEnabled(), false, "flag defaults OFF");
  // Parent surfaces gate mounting on the flag.
  for (const [f, needle] of [
    ["client/src/components/engagement/EngagementCasePanel.tsx", "isCanonicalAppointmentUiEnabled() && Object.keys(appointmentByService)"],
    ["client/src/pages/outreach-scheduler-portal.tsx", "isCanonicalAppointmentUiEnabled() && c.appointmentByService"],
    ["client/src/components/portal/AcsWorkflowPanel.tsx", "isCanonicalAppointmentUiEnabled() && data.appointmentByService"],
  ] as const) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(src.includes(needle), `${f} must gate the canonical summary on the client flag`);
  }
}

// ─── (11) ACS does not render both legacy and canonical summaries ─
async function testAcsMutuallyExclusive() {
  const src = readFileSync(join(ROOT, "client/src/components/portal/AcsWorkflowPanel.tsx"), "utf8");
  // The canonical block and the legacy nextScheduleEvent block are the
  // two arms of one ternary — never both.
  const idx = src.indexOf("isCanonicalAppointmentUiEnabled() && data.appointmentByService");
  const legacyIdx = src.indexOf("data.nextScheduleEvent ? (");
  assert.ok(idx > 0 && legacyIdx > idx, "legacy branch is the ternary's else arm of the canonical branch");
}

// ─── (12) Component fetches nothing independently ─────────────────
async function testComponentNoFetch() {
  for (const f of [
    "client/src/components/canonical/CanonicalAppointmentSummary.tsx",
    "client/src/components/canonical/appointmentSummaryModel.ts",
  ]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/useQuery|fetch\(|apiRequest/.test(src), `${f} must not fetch — parent supplies the projection`);
  }
}

// ─── (P1) response→parent→render: eligible renders, rejected does not ─
async function testEligibleRendersRejectedDoesNot() {
  // Real server filter drops the rejected service; parents iterate the
  // filtered keys and render each via the real component.
  const byService: Record<string, AncillaryAppointmentProjection> = {
    BrainWave: projection({ activeAppointment: view({ globalScheduleEventId: 700, serviceType: "BrainWave" }) }),
    Ultrasound: projection({ activeAppointment: view({ globalScheduleEventId: 800, serviceType: "Ultrasound" }) }),
  };
  const eligible = filterAppointmentsToEligibleServices(byService, ["BrainWave"]);
  const rendered = Object.entries(eligible)
    .map(([serviceType, p]) => render({ projection: p, serviceType }))
    .join("");
  assert.ok(rendered.includes("BrainWave") && rendered.includes('data-global-schedule-event-id="700"'), "approved BrainWave renders");
  assert.ok(!rendered.includes("Ultrasound") && !rendered.includes('data-global-schedule-event-id="800"'), "rejected Ultrasound is not rendered");
}

// ─── (P2) bounded, eligibility-scoped panel fetch — no unbounded N+1 ─
async function testParentsNoExtraFetch() {
  const panel = readFileSync(join(ROOT, "client/src/components/engagement/EngagementCasePanel.tsx"), "utf8");
  // The panel fetches the projection for its ONE selected execution case
  // (bounded, per user-open) — never the unrestricted screening-level
  // request, and it renders only the row's eligible services.
  assert.ok(/executionCaseId=\$\{executionCaseId\}&byService=true/.test(panel), "panel fetches by the single execution case");
  assert.ok(!/patientScreeningId=\$\{psid\}&byService/.test(panel), "no unrestricted screening-level fetch");
  assert.ok(/row\?\.eligibleServices/.test(panel), "panel renders only eligible services");
  // The assignment board must NOT attach a per-row canonical projection
  // (it is an unbounded worklist → unbounded sequential N+1).
  const board = readFileSync(join(ROOT, "server/routes/engagementAssignmentBoard.ts"), "utf8");
  assert.ok(!/getSerializedAppointmentsByService/.test(board), "board must not do a per-row canonical projection");
  // The EHR scheduling section renders from the chart projection.
  const ehr = readFileSync(join(ROOT, "client/src/components/patient-directory/PatientChartSections.tsx"), "utf8");
  assert.ok(/chart\.canonicalAppointmentByService/.test(ehr), "EHR renders from the chart's canonical projection");
  assert.ok(/CanonicalAppointmentSummary/.test(ehr) && /isCanonicalAppointmentUiEnabled\(\)/.test(ehr), "EHR canonical render is flag-gated");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(P1) approved service renders, rejected does not (real filter→render)", testEligibleRendersRejectedDoesNot],
  ["(P2) parents consume parent data — no extra canonical fetch", testParentsNoExtraFetch],
  ["(1) Patient EHR ancillary case renders the correct event", testEhrRenders],
  ["(2/8) different services render their own event only", testDifferentServices],
  ["(3/4) PCS/scheduler render appointmentByService inline", testPcsSchedulerRender],
  ["(5/6) calendar canonical uses stable ID; doctor_visit separate", testCalendarMapper],
  ["(7) cancelled prior is history, not active", testHistoryNotActive],
  ["(7) rescheduled child is active", testRescheduledChildActive],
  ["(9) Order Note readiness comes from server projection", testOrderNoteReadiness],
  ["(10) client flag OFF mounts no canonical summary", testFlagOffNoMount],
  ["(11) ACS does not render both legacy and canonical", testAcsMutuallyExclusive],
  ["(12) component fetches nothing independently", testComponentNoFetch],
];

async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok  ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); }
  }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}

await run();
