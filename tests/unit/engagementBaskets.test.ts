// Phase 5 basket membership rule tests.
//
// Runs standalone with:
//   npx tsx tests/unit/engagementBaskets.test.ts

import assert from "node:assert/strict";
import {
  basketsForCase,
  TERMINAL_ENGAGEMENT_STATUSES,
  type BasketCaseInput,
} from "../../server/services/engagement/basketRules";

const startToday = new Date("2026-07-08T00:00:00Z");
const endToday = new Date("2026-07-08T23:59:59Z");

const base = (over: Partial<BasketCaseInput> = {}): BasketCaseInput => ({
  isAssigned: false,
  isActive: true,
  engagementStatus: null,
  disposition: null,
  nextActionAt: null,
  startToday,
  endToday,
  ...over,
});

async function testUnassignedActiveGoesToUnassigned() {
  const keys = basketsForCase(base({ isAssigned: false, isActive: true }));
  assert.deepEqual(keys, ["unassigned"]);
}

async function testAssignedWithinTodayIsAssignedToday() {
  const midDay = new Date("2026-07-08T12:00:00Z");
  const keys = basketsForCase(
    base({
      isAssigned: true,
      isActive: true,
      engagementStatus: "in_progress",
      nextActionAt: midDay,
    }),
  );
  assert.deepEqual(keys, ["assignedToday"]);
}

async function testAssignedOverdueIsCarryover() {
  const yesterday = new Date("2026-07-07T20:00:00Z");
  const keys = basketsForCase(
    base({
      isAssigned: true,
      isActive: true,
      engagementStatus: "in_progress",
      nextActionAt: yesterday,
    }),
  );
  assert.deepEqual(keys, ["carryover"]);
}

async function testCarryoverPlusVoicemailStackable() {
  // Same case can belong to multiple baskets — tiles are filters, not a
  // partition.
  const yesterday = new Date("2026-07-07T20:00:00Z");
  const keys = basketsForCase(
    base({
      isAssigned: true,
      isActive: true,
      engagementStatus: "in_progress",
      disposition: "voicemail",
      nextActionAt: yesterday,
    }),
  );
  assert.deepEqual(keys.sort(), ["carryover", "voicemailLeft"].sort());
}

async function testScheduledStatusMapsToScheduledBasket() {
  const keys = basketsForCase(
    base({
      isAssigned: true,
      engagementStatus: "scheduled",
    }),
  );
  assert.deepEqual(keys, ["scheduled"]);
}

async function testScheduledDispositionMapsToScheduledBasket() {
  const keys = basketsForCase(base({ disposition: "scheduled" }));
  assert.ok(keys.includes("scheduled"));
}

async function testCompletedDispositionMapsToCompletedConversations() {
  const keys = basketsForCase(
    base({
      isAssigned: true,
      isActive: true,
      engagementStatus: "in_progress",
      disposition: "completed",
    }),
  );
  assert.ok(keys.includes("completedConversations"));
}

async function testNoAnswerFollowUpDeclinedDispositionsBucket() {
  const noAns = basketsForCase(base({ disposition: "noAnswer" }));
  const follow = basketsForCase(base({ disposition: "followUp" }));
  const decl = basketsForCase(base({ disposition: "declined" }));
  assert.ok(noAns.includes("noAnswer"));
  assert.ok(follow.includes("followUpNeeded"));
  assert.ok(decl.includes("declined"));
}

async function testInactiveCaseDoesNotBucketToWorkTiles() {
  const keys = basketsForCase(
    base({ isAssigned: false, isActive: false }),
  );
  assert.equal(keys.length, 0);
}

async function testTerminalStatusSuppressesUnassigned() {
  // A terminal-status case (scheduled/completed) should NOT surface in
  // "unassigned" even if isAssigned is false — the work is done.
  for (const terminal of TERMINAL_ENGAGEMENT_STATUSES) {
    const keys = basketsForCase(
      base({ isAssigned: false, engagementStatus: terminal }),
    );
    assert.ok(
      !keys.includes("unassigned"),
      `terminal status "${terminal}" leaked to unassigned`,
    );
  }
}

async function testTerminalStatusSuppressesAssignedToday() {
  const midDay = new Date("2026-07-08T12:00:00Z");
  const keys = basketsForCase(
    base({
      isAssigned: true,
      isActive: true,
      engagementStatus: "completed",
      nextActionAt: midDay,
    }),
  );
  assert.ok(!keys.includes("assignedToday"));
  assert.ok(!keys.includes("carryover"));
}

async function main() {
  await testUnassignedActiveGoesToUnassigned();
  await testAssignedWithinTodayIsAssignedToday();
  await testAssignedOverdueIsCarryover();
  await testCarryoverPlusVoicemailStackable();
  await testScheduledStatusMapsToScheduledBasket();
  await testScheduledDispositionMapsToScheduledBasket();
  await testCompletedDispositionMapsToCompletedConversations();
  await testNoAnswerFollowUpDeclinedDispositionsBucket();
  await testInactiveCaseDoesNotBucketToWorkTiles();
  await testTerminalStatusSuppressesUnassigned();
  await testTerminalStatusSuppressesAssignedToday();
  console.log("engagementBaskets.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
