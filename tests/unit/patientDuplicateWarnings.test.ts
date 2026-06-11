import assert from "node:assert/strict";
import {
  computeDuplicateWarnings,
  hasBlockingWarning,
} from "../../client/src/lib/patientDuplicateWarnings";
import { selectAllRuns, selectByRuns } from "../../client/src/lib/qualificationRunOrdering";

const jane = {
  name: "Jane Doe",
  facility: "Plexus Cary",
  mrn: "M-100",
  dob: "1980-05-12",
  phoneNumber: "2025550101",
};

const johnB = {
  name: "John B",
  facility: "Plexus Cary",
  mrn: "M-200",
  dob: "1975-03-04",
  phoneNumber: "5555550000",
};

async function main() {
  // Prior run roster: two runs same date.
  const priorRoster = [
    {
      batchId: 10, batchCreatedAt: "2026-06-10T08:42:00Z", patientType: "outreach",
      patientId: 1, name: "Jane Doe",
      patientScreeningId: 1, identity: jane, patientName: "Jane Doe",
    },
    {
      batchId: 11, batchCreatedAt: "2026-06-10T11:17:00Z", patientType: "outreach",
      patientId: 2, name: "John B",
      patientScreeningId: 2, identity: johnB, patientName: "John B",
    },
  ];

  // Current run includes Jane again — should match against batch 10.
  const current = [
    { patientScreeningId: 50, identity: jane, patientName: "Jane Doe (today)" },
    { patientScreeningId: 51, identity: { name: "Fresh Newpatient", dob: "1990-01-01", phoneNumber: "1112223333" }, patientName: "Fresh Newpatient" },
  ];

  // Facts: Jane was DNC and previously sent to engagement.
  const facts = {
    sentToEngagement: [{ patientScreeningId: 1, identity: jane, patientName: "Jane Doe", sentAt: "2026-06-10T15:00:00Z" }],
    doNotContact: [{ patientScreeningId: 1, identity: jane, patientName: "Jane Doe", reason: "Patient request", setAt: "2026-06-10T16:00:00Z" }],
    cooldowns: [],
    priorTests: [{ identity: jane, testName: "Echocardiogram TTE", dateOfService: "2025-12-01", facility: "Plexus Cary" }],
  };

  const results = computeDuplicateWarnings({
    currentPatients: current,
    priorRunRoster: priorRoster,
    selection: selectAllRuns(),
    facts,
  });
  assert.equal(results.length, 2);
  const j = results[0];
  // Run match warning
  const runWarn = j.warnings.find((w) => w.kind === "matched_prior_run");
  assert.ok(runWarn);
  assert.match(runWarn.message, /Matched prior run/);
  // Previously sent
  assert.ok(j.warnings.find((w) => w.kind === "previously_sent_to_engagement"));
  // DNC blocks
  const dnc = j.warnings.find((w) => w.kind === "do_not_contact");
  assert.ok(dnc);
  assert.equal(dnc.blocksOutreach, true);
  assert.equal(j.blockedFromOutreach, true);
  // Prior ancillary test
  assert.ok(j.warnings.find((w) => w.kind === "prior_ancillary_test"));

  // Fresh patient → no warnings.
  assert.equal(results[1].warnings.length, 0);
  assert.equal(results[1].blockedFromOutreach, false);

  // hasBlockingWarning across set.
  assert.equal(hasBlockingWarning(results), true);

  // selectByRuns subset.
  const subset = computeDuplicateWarnings({
    currentPatients: current,
    priorRunRoster: priorRoster,
    selection: selectByRuns([11]), // ignore Jane's batch
    facts: { sentToEngagement: [], doNotContact: [], cooldowns: [], priorTests: [] },
  });
  assert.equal(subset[0].matchedRuns.length, 0);

  // Active cooldown blocks.
  const cdResults = computeDuplicateWarnings({
    currentPatients: [{ patientScreeningId: 60, identity: jane, patientName: "Jane Doe" }],
    priorRunRoster: [],
    selection: selectAllRuns(),
    facts: {
      sentToEngagement: [],
      doNotContact: [],
      cooldowns: [{
        patientScreeningId: 1, identity: jane, patientName: "Jane Doe",
        active: true, endsAt: "2026-08-01", reason: "30-day rule",
      }],
      priorTests: [],
    },
  });
  const cdW = cdResults[0].warnings.find((w) => w.kind === "active_cooldown");
  assert.ok(cdW);
  assert.equal(cdResults[0].blockedFromOutreach, true);

  // Expired cooldown is informational, not blocking.
  const expResults = computeDuplicateWarnings({
    currentPatients: [{ patientScreeningId: 60, identity: jane, patientName: "Jane Doe" }],
    priorRunRoster: [],
    selection: selectAllRuns(),
    facts: {
      sentToEngagement: [],
      doNotContact: [],
      cooldowns: [{
        patientScreeningId: 1, identity: jane, patientName: "Jane Doe",
        active: false, endsAt: "2026-01-01", reason: "30-day rule",
      }],
      priorTests: [],
    },
  });
  const expW = expResults[0].warnings.find((w) => w.kind === "expired_cooldown_historical");
  assert.ok(expW);
  assert.equal(expResults[0].blockedFromOutreach, false);

  console.log("Patient duplicate warning engine test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
