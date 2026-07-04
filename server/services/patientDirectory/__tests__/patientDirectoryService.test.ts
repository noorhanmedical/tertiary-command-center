import { it } from "vitest";
import assert from "node:assert/strict";
import {
  getPatientDirectorySnapshot,
  isPatientDirectoryServiceEnabled,
  type PatientDirectoryDeps,
} from "../patientDirectoryService";

function makeDeps(overrides: Partial<PatientDirectoryDeps> = {}): PatientDirectoryDeps {
  return {
    async loadProfile(id) {
      return {
        patientScreeningId: id,
        identity: {
          name: "Jane Doe",
          facility: "Plexus Cary",
          dob: "1980-05-12",
          phoneNumber: "2025550101",
          email: null,
          insurance: null,
        },
        patientType: "outreach",
        adminApprovalStatus: "approved",
        adminApprovedAt: "2026-06-11T12:00:00Z",
        adminApprovedByUserId: "user-1",
        createdAt: "2026-06-10T08:00:00Z",
        source: {
          batchId: 99,
          batchName: "June 10 outreach",
          batchCreatedAt: "2026-06-10T07:50:00Z",
          sourceFileName: null,
        },
      };
    },
    async loadEngagement(id) {
      return {
        patientScreeningId: id,
        currentAssignmentId: 1,
        currentAssignmentStatus: "in_progress",
        currentAssignedTo: "user-2",
        lastEngagementUpdate: "2026-06-11T14:00:00Z",
      };
    },
    async loadCallHistory(_id) { return []; },
    async loadCooldown(_id) { return null; },
    async loadPriorTests(_id) { return []; },
    async loadEvents(_id) { return []; },
    ...overrides,
  };
}

async function main() {
  // Flag default OFF.
  assert.equal(isPatientDirectoryServiceEnabled({}), false);
  assert.equal(isPatientDirectoryServiceEnabled({ USE_PATIENT_DIRECTORY_SERVICE: "1" }), true);

  // Null profile -> null snapshot.
  {
    const deps = makeDeps({ async loadProfile() { return null; } });
    const snap = await getPatientDirectorySnapshot(7, deps);
    assert.equal(snap, null);
  }

  // Happy path -> snapshot includes derived flags.
  {
    const snap = await getPatientDirectorySnapshot(7, makeDeps());
    assert.ok(snap);
    assert.equal(snap.flags.everSentToEngagement, true);
    assert.equal(snap.flags.everAdminApproved, true);
    assert.equal(snap.flags.doNotContact, false);
  }

  // DNC flag derived from refused_dnc call outcome.
  {
    const snap = await getPatientDirectorySnapshot(7, makeDeps({
      async loadCallHistory() {
        return [{
          id: 1, patientScreeningId: 7, startedAt: "2026-06-11T10:00:00Z",
          outcome: "refused_dnc", notes: "Patient asked never to call again",
          callbackAt: null, attemptNumber: 1, durationSeconds: 35, isDncOutcome: true,
        }];
      },
    }));
    assert.ok(snap);
    assert.equal(snap.flags.doNotContact, true);
    assert.equal(snap.flags.doNotContactReason, "Patient asked never to call again");
  }

  // everSentToEngagement also true when an event marks it but no assignment row exists.
  {
    const snap = await getPatientDirectorySnapshot(7, makeDeps({
      async loadEngagement() { return null; },
      async loadEvents() { return [{ kind: "sent_to_engagement", occurredAt: "2026-06-11T15:00:00Z", actorUserId: "u", payload: {} }]; },
    }));
    assert.ok(snap);
    assert.equal(snap.flags.everSentToEngagement, true);
  }

  console.log("Patient Directory service test passed.");
}

it("Patient Directory service", async () => {
  await main();
});
