// PERMANENT regression — handoff policy helpers (Final Acceptance §14 D/E/F).
//
//   D. handoff eligibility priority rules (capacity gate)
//   E. P1/P2 may exceed a recipient's capacity; P3-P5 may not (unless override)
//   F. P1/P2 require acknowledgement before completion
//   + SLA exposure (overdue / awaiting-ack) is computed correctly
//
// Pure — asserts the shared policy helpers directly (no DB, no network).
//
//   npx tsx tests/acceptance/handoffPolicy.test.ts

process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  handoffMayExceedCapacity,
  handoffRequiresAcknowledgement,
  type CallHandoff,
} from "../../shared/schema";
import { computeHandoffSla } from "../../server/services/engagement/callHandoffService";

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${label}: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── E. Capacity-exceed rule ─────────────────────────────────────────────────
check("E: P1/P2 may exceed capacity without override", () => {
  assert.equal(handoffMayExceedCapacity("P1", false), true, "P1 always may exceed");
  assert.equal(handoffMayExceedCapacity("P2", false), true, "P2 always may exceed");
});
check("E: P3-P5 may NOT exceed capacity without a manager override", () => {
  assert.equal(handoffMayExceedCapacity("P3", false), false);
  assert.equal(handoffMayExceedCapacity("P4", false), false);
  assert.equal(handoffMayExceedCapacity("P5", false), false);
});
check("E: manager override lets P3-P5 exceed capacity", () => {
  assert.equal(handoffMayExceedCapacity("P3", true), true);
  assert.equal(handoffMayExceedCapacity("P5", true), true);
});

// ─── F. Acknowledgement-required rule ────────────────────────────────────────
check("F: P1/P2 require acknowledgement; P3-P5 do not", () => {
  assert.equal(handoffRequiresAcknowledgement("P1"), true);
  assert.equal(handoffRequiresAcknowledgement("P2"), true);
  assert.equal(handoffRequiresAcknowledgement("P3"), false);
  assert.equal(handoffRequiresAcknowledgement("P4"), false);
  assert.equal(handoffRequiresAcknowledgement("P5"), false);
});
check("F: null/unknown priority does not require acknowledgement", () => {
  assert.equal(handoffRequiresAcknowledgement(null), false);
  assert.equal(handoffRequiresAcknowledgement(undefined), false);
});

// ─── SLA exposure (Phase 6B) ─────────────────────────────────────────────────
function handoff(over: Partial<CallHandoff>): CallHandoff {
  const now = new Date();
  return {
    id: 1,
    executionCaseId: 1,
    patientScreeningId: null,
    fromUserId: "a",
    toUserId: "b",
    facilityId: null,
    priorityLevel: "P2",
    reason: "test",
    note: null,
    dueAt: null,
    status: "pending",
    source: "peer",
    managerOverride: false,
    viewedAt: null,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    completedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    createdByUserId: "a",
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as CallHandoff;
}

check("SLA: a pending P2 with a past dueAt is overdue AND awaiting-ack", () => {
  const past = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const created = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const sla = computeHandoffSla(handoff({ status: "pending", priorityLevel: "P2", dueAt: past, createdAt: created }));
  assert.equal(sla.awaitingAck, true, "pending P2 awaits ack");
  assert.equal(sla.isOverdue, true, "past dueAt is overdue");
  assert.equal(sla.overdueForAck, true, "overdue AND awaiting ack");
  assert.ok(sla.ageMs >= 2 * 60 * 60 * 1000 - 5000, "age reflects createdAt");
});
check("SLA: an acknowledged handoff is no longer awaiting-ack", () => {
  const sla = computeHandoffSla(handoff({ status: "acknowledged", acknowledgedAt: new Date() }));
  assert.equal(sla.awaitingAck, false, "acknowledged clears awaiting-ack");
});
check("SLA: a pending P3 with no dueAt is not overdue and not awaiting-ack", () => {
  const sla = computeHandoffSla(handoff({ status: "pending", priorityLevel: "P3", dueAt: null }));
  assert.equal(sla.isOverdue, false);
  assert.equal(sla.awaitingAck, false, "P3 never requires ack");
  assert.equal(sla.overdueForAck, false);
});
check("SLA: a completed handoff is neither overdue nor awaiting-ack", () => {
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const sla = computeHandoffSla(handoff({ status: "completed", dueAt: past, completedAt: new Date() }));
  assert.equal(sla.isOverdue, false, "closed handoff is not overdue");
  assert.equal(sla.awaitingAck, false);
});

if (failures > 0) {
  console.error(`\nhandoffPolicy.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nhandoffPolicy.test.ts: all tests passed");
