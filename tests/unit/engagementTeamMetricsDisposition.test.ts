// Phase 1 — Engagement team-metrics disposition mapping tests.
//
// The disposition mapping is the single source of truth for how call
// outcomes are bucketed by both the /api/engagement/team-metrics rollup
// AND the engagement baskets read-model. Any drift here would silently
// mis-count Completed Conversations vs Voicemail / No Answer.
//
// Runs standalone with:
//   npx tsx tests/unit/engagementTeamMetricsDisposition.test.ts

import assert from "node:assert/strict";
import {
  mapOutcomeToDisposition,
  outcomeFromJourneyMetadata,
  emptyDispositionBreakdown,
  DISPOSITION_CATEGORIES,
} from "../../server/services/engagement/teamMetricsDisposition";

async function testEveryOutcomeIsBucketed() {
  const outcomes = [
    "scheduled",
    "completed",
    "reached",
    "no_answer",
    "busy",
    "hung_up",
    "disconnected",
    "mailbox_full",
    "voicemail",
    "declined",
    "not_interested",
    "refused_dnc",
    "dnc",
    "do_not_contact",
    "wrong_number",
    "moved",
    "deceased",
    "cancelled",
    "language_barrier",
    "callback",
    "wants_more_info",
    "will_think_about_it",
    "needs_records",
    "insurance_prior_auth_issue",
    "manager_review",
    "facility_specific_issue",
  ];
  for (const o of outcomes) {
    const d = mapOutcomeToDisposition(o);
    assert.ok(
      (DISPOSITION_CATEGORIES as readonly string[]).includes(d),
      `outcome "${o}" mapped to unknown category "${d}"`,
    );
  }
}

async function testUnknownOutcomeGoesToOther() {
  assert.equal(mapOutcomeToDisposition("time_traveled"), "other");
  assert.equal(mapOutcomeToDisposition(""), "other");
}

async function testPositiveTerminalsBucketToScheduled() {
  assert.equal(mapOutcomeToDisposition("scheduled"), "scheduled");
  assert.equal(mapOutcomeToDisposition("completed"), "scheduled");
}

async function testLiveConversationBucketsToCompleted() {
  assert.equal(mapOutcomeToDisposition("reached"), "completed");
}

async function testNoAnswerFamily() {
  for (const o of ["no_answer", "busy", "hung_up", "disconnected", "mailbox_full"]) {
    assert.equal(mapOutcomeToDisposition(o), "noAnswer", `${o} should bucket noAnswer`);
  }
}

async function testVoicemailIsItsOwnBucket() {
  assert.equal(mapOutcomeToDisposition("voicemail"), "voicemail");
}

async function testDeclinedFamily() {
  for (const o of [
    "declined",
    "not_interested",
    "refused_dnc",
    "dnc",
    "do_not_contact",
    "wrong_number",
    "moved",
    "deceased",
    "cancelled",
    "language_barrier",
  ]) {
    assert.equal(mapOutcomeToDisposition(o), "declined", `${o} should bucket declined`);
  }
}

async function testFollowUpFamily() {
  for (const o of [
    "callback",
    "wants_more_info",
    "will_think_about_it",
    "needs_records",
    "insurance_prior_auth_issue",
    "manager_review",
    "facility_specific_issue",
  ]) {
    assert.equal(mapOutcomeToDisposition(o), "followUp", `${o} should bucket followUp`);
  }
}

async function testOutcomeFromJourneyMetadataReadsCallResult() {
  assert.equal(outcomeFromJourneyMetadata({ callResult: "voicemail" }), "voicemail");
}

async function testOutcomeFromJourneyMetadataHandlesAliases() {
  assert.equal(outcomeFromJourneyMetadata({ callDisposition: "no_answer" }), "no_answer");
  assert.equal(outcomeFromJourneyMetadata({ outcome: "callback" }), "callback");
}

async function testOutcomeFromJourneyMetadataPrefersCallResult() {
  const result = outcomeFromJourneyMetadata({
    callResult: "voicemail",
    outcome: "no_answer",
  });
  assert.equal(result, "voicemail", "callResult wins over outcome");
}

async function testOutcomeFromJourneyMetadataRejectsMissing() {
  assert.equal(outcomeFromJourneyMetadata(null), null);
  assert.equal(outcomeFromJourneyMetadata(undefined), null);
  assert.equal(outcomeFromJourneyMetadata({}), null);
  assert.equal(outcomeFromJourneyMetadata("string"), null);
  assert.equal(outcomeFromJourneyMetadata({ callResult: "" }), null);
  assert.equal(outcomeFromJourneyMetadata({ callResult: "   " }), null);
}

async function testEmptyBreakdownSumsToZero() {
  const b = emptyDispositionBreakdown();
  const total = Object.values(b).reduce((sum, n) => sum + n, 0);
  assert.equal(total, 0);
  for (const cat of DISPOSITION_CATEGORIES) {
    assert.equal(b[cat], 0);
  }
}

async function main() {
  await testEveryOutcomeIsBucketed();
  await testUnknownOutcomeGoesToOther();
  await testPositiveTerminalsBucketToScheduled();
  await testLiveConversationBucketsToCompleted();
  await testNoAnswerFamily();
  await testVoicemailIsItsOwnBucket();
  await testDeclinedFamily();
  await testFollowUpFamily();
  await testOutcomeFromJourneyMetadataReadsCallResult();
  await testOutcomeFromJourneyMetadataHandlesAliases();
  await testOutcomeFromJourneyMetadataPrefersCallResult();
  await testOutcomeFromJourneyMetadataRejectsMissing();
  await testEmptyBreakdownSumsToZero();
  console.log("engagementTeamMetricsDisposition.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
