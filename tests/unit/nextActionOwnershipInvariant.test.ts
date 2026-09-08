// Phase 1 — Invariant #1 (ownership change must NOT change patient timing).
//
// Unit-tests the single shared assignment-time next-action resolver used by
// BOTH auto-distribution (distributionService.applyDistribution) and manual
// reassignment (engagementAssignmentBoard). This module is DB-free, so the
// test runs without DATABASE_URL.
//
// Run: npx tsx tests/unit/nextActionOwnershipInvariant.test.ts

import assert from "node:assert/strict";
import { resolveAssignmentNextActionAt } from "../../server/services/callList/nextActionPolicy";

async function main() {
  const now = new Date("2026-06-11T12:00:00.000Z");

  // 1. A pending FUTURE callback ("call me Friday 2 PM") is preserved EXACTLY
  //    across an ownership change. This is the core business invariant.
  const friday2pm = new Date("2026-06-12T14:00:00.000Z");
  const preservedFuture = resolveAssignmentNextActionAt(friday2pm, now);
  assert.equal(
    preservedFuture.getTime(),
    friday2pm.getTime(),
    "future callback must be preserved to the exact millisecond",
  );

  // 2. Future callback supplied as an ISO string is also preserved exactly.
  const preservedFromString = resolveAssignmentNextActionAt(friday2pm.toISOString(), now);
  assert.equal(preservedFromString.getTime(), friday2pm.getTime());

  // 3. No existing next-action → surface now (fresh assignment).
  const fresh = resolveAssignmentNextActionAt(null, now);
  assert.equal(fresh.getTime(), now.getTime(), "null next-action surfaces now");
  const freshUndef = resolveAssignmentNextActionAt(undefined, now);
  assert.equal(freshUndef.getTime(), now.getTime());

  // 4. A PAST-due next-action → surface now (already due; owner change does
  //    not make it more or less due). It is never pushed further out.
  const yesterday = new Date("2026-06-10T09:00:00.000Z");
  const overdue = resolveAssignmentNextActionAt(yesterday, now);
  assert.equal(overdue.getTime(), now.getTime(), "overdue work surfaces now");

  // 5. Garbage/invalid timestamp is treated as "no future action" → now.
  const garbage = resolveAssignmentNextActionAt("not-a-date", now);
  assert.equal(garbage.getTime(), now.getTime());

  // 6. Exactly-now is NOT "future" (strict >) → returns now (idempotent).
  const exactlyNow = resolveAssignmentNextActionAt(new Date(now), now);
  assert.equal(exactlyNow.getTime(), now.getTime());

  console.log("nextAction ownership invariant test passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
