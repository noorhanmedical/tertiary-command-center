// Unit tests for the Confirm-distribution PURE helpers (Task 4).
//
// deriveConflictReason maps a canonical case row to a PHI-safe conflict reason
// used when a reviewed patient became ineligible between preview and confirm
// (excluded, never silently replaced). The DB-backed confirm flow (idempotency,
// assignment, packages) is exercised in the Task 11 acceptance suite.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListConfirm.test.ts

import assert from "node:assert/strict";
import { deriveConflictReason } from "../../server/services/engagement/callListConfirm";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListConfirm:");

check("missing case → no-longer-exists", () => {
  assert.match(deriveConflictReason(undefined), /no longer exists/i);
});

check("terminal lifecycle → no longer active", () => {
  assert.match(
    deriveConflictReason({ lifecycleStatus: "completed", engagementStatus: "assigned", assignedTeamMemberId: null }),
    /no longer active/i,
  );
});

check("scheduled → scheduled-since-preview", () => {
  assert.match(
    deriveConflictReason({ lifecycleStatus: "active", engagementStatus: "scheduled", assignedTeamMemberId: null }),
    /scheduled/i,
  );
});

check("other non-callable status is surfaced by name", () => {
  assert.match(
    deriveConflictReason({ lifecycleStatus: "active", engagementStatus: "closed", assignedTeamMemberId: null }),
    /closed/i,
  );
});

check("active + callable status → generic eligibility reason", () => {
  const reason = deriveConflictReason({
    lifecycleStatus: "active",
    engagementStatus: "assigned",
    assignedTeamMemberId: 5,
  });
  assert.match(reason, /No longer eligible/i);
});

console.log(`\ncallListConfirm: ${passed} checks passed\n`);
