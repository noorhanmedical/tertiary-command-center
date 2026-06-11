import assert from "node:assert/strict";
import {
  buildComparisonRunSet,
  buildQualificationGroups,
  makeRunLabel,
  orderPatientsWithinRun,
  parentDateKeyOf,
  selectAllRuns,
  selectByDate,
  selectByRuns,
  selectNoRuns,
} from "../../client/src/lib/qualificationRunOrdering";

async function main() {
  // Patient ordering — outreach alphabetical, visit by appointment time, grouped.
  const ordered = orderPatientsWithinRun([
    { batchId: 1, batchCreatedAt: "2026-06-11T08:42:00Z", patientType: "visit", patientId: 1, name: "Zane Visit", appointmentTime: "2026-06-12T10:00:00Z" },
    { batchId: 1, batchCreatedAt: "2026-06-11T08:42:00Z", patientType: "outreach", patientId: 2, name: "Bob Outreach" },
    { batchId: 1, batchCreatedAt: "2026-06-11T08:42:00Z", patientType: "outreach", patientId: 3, name: "Alice Outreach" },
    { batchId: 1, batchCreatedAt: "2026-06-11T08:42:00Z", patientType: "visit", patientId: 4, name: "Anna Visit", appointmentTime: "2026-06-12T09:00:00Z" },
  ]);
  assert.deepEqual(ordered.map((r) => r.name), ["Alice Outreach", "Bob Outreach", "Anna Visit", "Zane Visit"]);

  // Groups + run numbering + labels.
  const groups = buildQualificationGroups([
    { batchId: 10, batchCreatedAt: "2026-06-11T08:42:00Z", patientType: "outreach", patientId: 1, name: "A" },
    { batchId: 11, batchCreatedAt: "2026-06-11T11:17:00Z", patientType: "visit",   patientId: 2, name: "B", appointmentTime: "2026-06-12T09:00:00Z" },
    { batchId: 20, batchCreatedAt: "2026-06-10T15:00:00Z", patientType: "outreach", patientId: 3, name: "C" },
  ]);
  // Date order desc (default): 2026-06-11 first, then 2026-06-10.
  assert.deepEqual(groups.map((g) => g.parentDateKey), ["2026-06-11", "2026-06-10"]);
  // Run order desc within date (default).
  const r11 = groups[0].runs;
  assert.equal(r11.length, 2);
  assert.equal(r11[0].runId, 11);
  assert.equal(r11[1].runId, 10);
  // Run numbering is stable within date in chronological order:
  // Run 1 = batch 10 (earlier), Run 2 = batch 11 (later).
  assert.equal(r11[0].runNumberWithinDate, 2);
  assert.equal(r11[1].runNumberWithinDate, 1);
  assert.match(r11[0].runLabel, /Run 2 - June 11, 2026/);
  assert.equal(r11[0].patientCount, 1);
  assert.equal(r11[1].patientCount, 1);
  // Date order ascending option.
  const ascGroups = buildQualificationGroups([
    { batchId: 1, batchCreatedAt: "2026-06-10T08:00:00Z", patientType: "visit", patientId: 1, name: "x" },
    { batchId: 2, batchCreatedAt: "2026-06-11T08:00:00Z", patientType: "visit", patientId: 2, name: "y" },
  ], { dateOrder: "asc", runOrder: "asc" });
  assert.deepEqual(ascGroups.map((g) => g.parentDateKey), ["2026-06-10", "2026-06-11"]);

  // Comparison set selection.
  const all = buildComparisonRunSet(groups, selectAllRuns());
  assert.equal(all.length, 3);
  assert.equal(buildComparisonRunSet(groups, selectNoRuns()).length, 0);
  const date = buildComparisonRunSet(groups, selectByDate("2026-06-11"));
  assert.equal(date.length, 2);
  const runs = buildComparisonRunSet(groups, selectByRuns([10, 20]));
  assert.deepEqual(runs.map((r) => r.runId).sort(), [10, 20]);

  // parentDateKeyOf is tolerant of garbage.
  assert.equal(parentDateKeyOf("not a date"), "");
  assert.equal(makeRunLabel(1, "2026-06-11T08:42:00Z").startsWith("Run 1 - June 11, 2026"), true);

  console.log("Qualification run ordering test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
