// Phase 2D-C2 — canonical appointment portal component behavior.
//
// The repo has no jsdom/testing-library runner; components are pure
// functions of the server projection. This exercises the REAL rendering
// logic (deriveAppointmentSummary — what drives every rendered field)
// plus the client feature-flag gate, behaviorally (not source regex).
//
// Run standalone with:
//   npx tsx tests/unit/canonicalAppointmentPortalComponents.test.tsx

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveAppointmentSummary,
} from "../../client/src/components/canonical/appointmentSummaryModel";
import { isCanonicalAppointmentUiEnabled } from "../../client/src/lib/canonicalAppointmentUiFlag";
import type {
  AncillaryAppointmentProjection,
  CanonicalAppointmentView,
} from "../../shared/types/canonicalAppointment";

const ROOT = process.cwd();
const START = "2027-02-01T10:00:00.000Z";

function view(over: Partial<CanonicalAppointmentView> = {}): CanonicalAppointmentView {
  return {
    globalScheduleEventId: 700, ancillaryCaseId: 300, patientScreeningId: 77, executionCaseId: 900,
    serviceType: "EchoWave", eventType: "ancillary_appointment", status: "scheduled",
    startsAt: START, endsAt: null, timezone: null, facilityId: "F", location: "F",
    assignedUserId: null, parentEventId: null, cancellationReason: null, noShowReason: null, ...over,
  };
}
function projection(over: Partial<AncillaryAppointmentProjection> = {}): AncillaryAppointmentProjection {
  return {
    activeAppointment: view(),
    appointmentHistory: [],
    appointmentEligibleForOrderNote: true,
    appointmentEligibilityReason: "qualifying_appointment",
    ...over,
  };
}

// ─── (1) Active scheduled renders ─────────────────────────────────
async function testActiveScheduled() {
  const vm = deriveAppointmentSummary(projection());
  assert.equal(vm.notScheduled, false);
  assert.equal(vm.statusLabel, "Scheduled");
  assert.equal(vm.statusVariant, "default");
  assert.equal(vm.globalScheduleEventId, 700);
  assert.ok(vm.whenLabel && vm.whenLabel.length > 0);
}

// ─── (2) Completed renders ────────────────────────────────────────
async function testCompleted() {
  const vm = deriveAppointmentSummary(projection({ activeAppointment: view({ status: "completed" }) }));
  assert.equal(vm.statusLabel, "Completed");
  assert.equal(vm.statusVariant, "secondary");
}

// ─── (3) No active appointment → "not scheduled" state ────────────
async function testNotScheduled() {
  const vm = deriveAppointmentSummary(projection({ activeAppointment: null }));
  assert.equal(vm.notScheduled, true);
  assert.equal(vm.statusLabel, null);
  assert.equal(vm.globalScheduleEventId, null);
}

// ─── (4) Cancelled appears only in history, not active ────────────
async function testCancelledHistoryOnly() {
  const vm = deriveAppointmentSummary(projection({
    activeAppointment: null,
    appointmentHistory: [view({ globalScheduleEventId: 700, status: "cancelled", cancellationReason: "x" })],
  }));
  assert.equal(vm.notScheduled, true, "cancelled is never active");
  assert.equal(vm.statusLabel, null);
  assert.equal(vm.historyCount, 1);
}

// ─── (5) No-show appears only in history ──────────────────────────
async function testNoShowHistoryOnly() {
  const vm = deriveAppointmentSummary(projection({
    activeAppointment: null,
    appointmentHistory: [view({ globalScheduleEventId: 700, status: "no_show", noShowReason: "x" })],
  }));
  assert.equal(vm.notScheduled, true);
  assert.equal(vm.historyCount, 1);
}

// ─── (6) Rescheduled prior item is not active (child is) ──────────
async function testRescheduledPriorNotActive() {
  const vm = deriveAppointmentSummary(projection({
    activeAppointment: view({ globalScheduleEventId: 701, status: "scheduled", parentEventId: 700 }),
    appointmentHistory: [view({ globalScheduleEventId: 700, status: "rescheduled" })],
  }));
  assert.equal(vm.globalScheduleEventId, 701, "child is active");
  assert.equal(vm.statusLabel, "Scheduled");
  assert.equal(vm.rescheduledFromEventId, 700, "prior lineage retained");
  assert.equal(vm.historyCount, 1);
}

// ─── (7) Different services render their own event IDs ────────────
async function testDifferentServices() {
  const echo = deriveAppointmentSummary(projection({ activeAppointment: view({ globalScheduleEventId: 700, serviceType: "EchoWave" }) }));
  const sleep = deriveAppointmentSummary(projection({ activeAppointment: view({ globalScheduleEventId: 800, serviceType: "SleepWave" }) }));
  assert.notEqual(echo.globalScheduleEventId, sleep.globalScheduleEventId);
  assert.equal(echo.serviceType, "EchoWave");
  assert.equal(sleep.serviceType, "SleepWave");
}

// ─── (8) doctor_visit is not rendered as an ancillary appointment ─
async function testDoctorVisitNotRendered() {
  // The server projection excludes doctor_visit → activeAppointment is
  // null for a doctor_visit-only case. The model uses the hint for the
  // service label and never surfaces an eventType-derived title.
  const vm = deriveAppointmentSummary(projection({ activeAppointment: null }), "EchoWave");
  assert.equal(vm.notScheduled, true);
  assert.equal(vm.serviceType, "EchoWave", "service from hint, never doctor_visit event");
}

// ─── (9) Order Note ready state comes from the server field ───────
async function testOrderNoteFromServer() {
  const ready = deriveAppointmentSummary(projection({ appointmentEligibleForOrderNote: true, appointmentEligibilityReason: "qualifying_appointment" }));
  assert.equal(ready.eligibleForOrderNote, true);
  assert.equal(ready.eligibilityReason, "qualifying_appointment");
  const notReady = deriveAppointmentSummary(projection({ appointmentEligibleForOrderNote: false, appointmentEligibilityReason: "no_qualifying_appointment" }));
  assert.equal(notReady.eligibleForOrderNote, false);
  assert.equal(notReady.eligibilityReason, "no_qualifying_appointment");
}

// ─── (10) Feature OFF → canonical UI gate is off by default ───────
async function testFlagOffByDefault() {
  assert.equal(isCanonicalAppointmentUiEnabled(), false, "VITE_FEATURE_CANONICAL_APPOINTMENT defaults OFF");
}

// ─── (11) Presentation-only: no data fetching in the component ────
async function testPresentationOnly() {
  const src = readFileSync(join(ROOT, "client/src/components/canonical/CanonicalAppointmentSummary.tsx"), "utf8");
  assert.ok(!/useQuery|fetch\(|apiRequest/.test(src), "shared component must not fetch — parent owns loading/error");
  const model = readFileSync(join(ROOT, "client/src/components/canonical/appointmentSummaryModel.ts"), "utf8");
  assert.ok(!/appointmentStatus|selectedServices|doctor_visit/.test(model), "model must not infer scheduling from legacy fields");
}

// ─── (12) Uses existing design tokens (no new theme / hardcoded hex) ─
async function testUsesExistingTokens() {
  const src = readFileSync(join(ROOT, "client/src/components/canonical/CanonicalAppointmentSummary.tsx"), "utf8");
  assert.ok(/@\/components\/ui\/badge/.test(src), "must reuse the existing Badge primitive");
  assert.ok(!/#[0-9a-fA-F]{6}/.test(src), "no hard-coded hex colors outside existing component conventions");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["(1) active scheduled renders", testActiveScheduled],
  ["(2) completed renders", testCompleted],
  ["(3) no active → not-scheduled state", testNotScheduled],
  ["(4) cancelled appears only in history", testCancelledHistoryOnly],
  ["(5) no-show appears only in history", testNoShowHistoryOnly],
  ["(6) rescheduled prior is not active", testRescheduledPriorNotActive],
  ["(7) different services render own event IDs", testDifferentServices],
  ["(8) doctor_visit is not rendered as ancillary", testDoctorVisitNotRendered],
  ["(9) Order Note ready state from server field", testOrderNoteFromServer],
  ["(10) feature OFF gate is off by default", testFlagOffByDefault],
  ["(11) presentation-only (no fetch, no legacy inference)", testPresentationOnly],
  ["(12) uses existing design tokens", testUsesExistingTokens],
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

run();
