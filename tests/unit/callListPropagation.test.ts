// Task 5 — Team Portal propagation CONTRACT lock.
//
// The Confirm flow appends a journey event whose eventType drives BOTH live
// streams (via publishLiveActivity, fired by the canonical journey writer):
//   • admin distribution stream forwards events in ACTIVITY_EVENT_TYPES.
//   • portal /api/engagement/activity-stream forwards events matching the
//     QUEUE_REFRESH token rule ("assign"/"call"/"schedul"/"engagement"/
//     "execution_case"); useEngagementActivityStream then invalidates the
//     team-workspace-call-list query (verified in scheduleInvalidations.ts).
//
// This test locks the emitted eventType so a future rename can't silently break
// propagation (patients failing to appear in an already-open Team Portal).
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListPropagation.test.ts

import assert from "node:assert/strict";
import { CALL_LIST_ASSIGNMENT_EVENT_TYPE } from "../../server/services/engagement/callListConfirm";
import { ACTIVITY_EVENT_TYPES } from "../../server/services/engagement/distributionService";

// Mirror of server QUEUE_REFRESH_TOKENS (engagementTeamMetrics.ts) — kept in
// sync deliberately so this test fails if the emitted eventType stops matching.
const QUEUE_REFRESH_TOKENS = ["assign", "call", "schedul", "engagement", "execution_case"];
function isQueueRefreshEvent(eventType: string): boolean {
  const t = eventType.toLowerCase();
  return QUEUE_REFRESH_TOKENS.some((tok) => t.includes(tok));
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListPropagation:");

check("emitted eventType is forwarded by the admin distribution stream", () => {
  assert.ok(
    (ACTIVITY_EVENT_TYPES as readonly string[]).includes(CALL_LIST_ASSIGNMENT_EVENT_TYPE),
    `${CALL_LIST_ASSIGNMENT_EVENT_TYPE} must be in ACTIVITY_EVENT_TYPES`,
  );
});

check("emitted eventType is forwarded by the portal activity-stream", () => {
  assert.equal(isQueueRefreshEvent(CALL_LIST_ASSIGNMENT_EVENT_TYPE), true);
});

console.log(`\ncallListPropagation: ${passed} checks passed\n`);
