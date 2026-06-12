// Unit test for the hotfix visible-ordering invariants. Same helper
// the workspace uses to sort patient rows.
import assert from "node:assert/strict";
import { orderPatientsWithinRun } from "../../client/src/lib/qualificationRunOrdering";

async function main() {
  // Outreach alphabetical: raw input Zimmerman, Brown, Adams, Miller →
  // visible Adams, Brown, Miller, Zimmerman.
  const outreach = orderPatientsWithinRun([
    { batchId: 1, batchCreatedAt: "", patientType: "outreach", patientId: 1, name: "Zimmerman, Sara" },
    { batchId: 1, batchCreatedAt: "", patientType: "outreach", patientId: 2, name: "Brown, Kevin" },
    { batchId: 1, batchCreatedAt: "", patientType: "outreach", patientId: 3, name: "Adams, Carla" },
    { batchId: 1, batchCreatedAt: "", patientType: "outreach", patientId: 4, name: "Miller, Dawn" },
  ]);
  assert.deepEqual(
    outreach.map((r) => r.name),
    ["Adams, Carla", "Brown, Kevin", "Miller, Dawn", "Zimmerman, Sara"],
  );

  // Visit appointment-time: raw 10:00, 8:30, 9:15 → visible 8:30, 9:15, 10:00.
  const visit = orderPatientsWithinRun([
    { batchId: 2, batchCreatedAt: "", patientType: "visit", patientId: 1, name: "10am Patient", appointmentTime: "2026-06-12T10:00:00Z" },
    { batchId: 2, batchCreatedAt: "", patientType: "visit", patientId: 2, name: "830 Patient",  appointmentTime: "2026-06-12T08:30:00Z" },
    { batchId: 2, batchCreatedAt: "", patientType: "visit", patientId: 3, name: "915 Patient",  appointmentTime: "2026-06-12T09:15:00Z" },
  ]);
  assert.deepEqual(
    visit.map((r) => r.appointmentTime),
    ["2026-06-12T08:30:00Z", "2026-06-12T09:15:00Z", "2026-06-12T10:00:00Z"],
  );

  // Mixed: outreach first (alphabetical), then visit (by appt time).
  const mixed = orderPatientsWithinRun([
    { batchId: 3, batchCreatedAt: "", patientType: "visit", patientId: 1, name: "Visit-Z", appointmentTime: "2026-06-12T10:00:00Z" },
    { batchId: 3, batchCreatedAt: "", patientType: "outreach", patientId: 2, name: "Outreach-Z" },
    { batchId: 3, batchCreatedAt: "", patientType: "outreach", patientId: 3, name: "Outreach-A" },
    { batchId: 3, batchCreatedAt: "", patientType: "visit", patientId: 4, name: "Visit-A", appointmentTime: "2026-06-12T08:00:00Z" },
  ]);
  assert.deepEqual(
    mixed.map((r) => r.name),
    ["Outreach-A", "Outreach-Z", "Visit-A", "Visit-Z"],
  );

  console.log("Visible ordering test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
