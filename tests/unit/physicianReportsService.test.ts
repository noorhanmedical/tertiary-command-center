// Phase 3 — Physician Portal reports service tests.
//
// Runs standalone with:
//   npx tsx tests/unit/physicianReportsService.test.ts
//
// This file exercises the pure math (window sizing + clamping) that
// bounds the aggregate SQL for the ancillary-metrics endpoint. Anything
// that touches the DB is covered by the shape of the underlying repo
// helpers and by the endpoint-level integration.

import assert from "node:assert/strict";
import {
  defaultAncillaryMetricsWindow,
  clampDaysWindow,
} from "../../server/services/physicianPortal/reportsRules";

async function testDefaultWindowIs30Days() {
  const now = new Date("2026-07-11T12:00:00Z");
  const w = defaultAncillaryMetricsWindow(now);
  assert.equal(w.endsAt.getTime(), now.getTime());
  const diffDays = (w.endsAt.getTime() - w.startsAt.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(diffDays, 30);
}

async function testDefaultWindowRespectsCustomDays() {
  const now = new Date("2026-07-11T12:00:00Z");
  const w = defaultAncillaryMetricsWindow(now, 7);
  const diffDays = (w.endsAt.getTime() - w.startsAt.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(diffDays, 7);
}

async function testClampDaysAcceptsValidNumbers() {
  assert.equal(clampDaysWindow(7), 7);
  assert.equal(clampDaysWindow(30), 30);
  assert.equal(clampDaysWindow(90), 90);
}

async function testClampDaysFloorAt1() {
  assert.equal(clampDaysWindow(0), 1);
  assert.equal(clampDaysWindow(-5), 1);
}

async function testClampDaysCeilAt365() {
  assert.equal(clampDaysWindow(9999), 365);
  assert.equal(clampDaysWindow(500), 365);
}

async function testClampDaysAcceptsStrings() {
  assert.equal(clampDaysWindow("14"), 14);
  assert.equal(clampDaysWindow("30"), 30);
}

async function testClampDaysFallsBackOnJunk() {
  assert.equal(clampDaysWindow("not a number"), 30);
  assert.equal(clampDaysWindow(undefined), 30);
  assert.equal(clampDaysWindow(null), 30);
  assert.equal(clampDaysWindow({}), 30);
  assert.equal(clampDaysWindow(NaN), 30);
}

async function testClampDaysCustomFallback() {
  assert.equal(clampDaysWindow(undefined, 7), 7);
  assert.equal(clampDaysWindow("junk", 90), 90);
}

async function testClampDaysRoundsFractional() {
  assert.equal(clampDaysWindow(14.5), 15);
  assert.equal(clampDaysWindow(14.4), 14);
}

async function main() {
  await testDefaultWindowIs30Days();
  await testDefaultWindowRespectsCustomDays();
  await testClampDaysAcceptsValidNumbers();
  await testClampDaysFloorAt1();
  await testClampDaysCeilAt365();
  await testClampDaysAcceptsStrings();
  await testClampDaysFallsBackOnJunk();
  await testClampDaysCustomFallback();
  await testClampDaysRoundsFractional();
  console.log("physicianReportsService.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
