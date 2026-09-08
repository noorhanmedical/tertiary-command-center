// Phase 1B — pure classification of terminal + DNC outcomes.
//
// Verifies the non-callable execution-case state chosen for each terminal
// disposition and the DNC-outcome set. DB-free (callAttemptRuntime imports
// nothing DB-bound), so it runs without DATABASE_URL.
//
// Run: npx tsx tests/unit/terminalAndDncClassification.test.ts

import assert from "node:assert/strict";
import {
  resolveTerminalExecutionState,
  isDncOutcome,
  NEGATIVE_TERMINAL_OUTCOMES,
  POSITIVE_TERMINAL_OUTCOMES,
  DNC_OUTCOMES,
} from "../../server/services/callResult/callAttemptRuntime";

async function main() {
  // Negative terminals → non-callable "closed"/"archived".
  for (const o of ["declined", "refused_dnc", "dnc", "do_not_contact", "deceased", "cancelled"]) {
    const s = resolveTerminalExecutionState(o);
    assert.ok(s, `${o} should be terminal`);
    assert.equal(s!.engagementStatus, "closed", `${o} → engagementStatus closed`);
    assert.equal(s!.lifecycleStatus, "archived", `${o} → lifecycleStatus archived`);
  }

  // Positive terminal (completed) → completed/completed.
  {
    const s = resolveTerminalExecutionState("completed");
    assert.ok(s);
    assert.equal(s!.engagementStatus, "completed");
    assert.equal(s!.lifecycleStatus, "completed");
  }

  // Case-insensitive.
  assert.ok(resolveTerminalExecutionState("Refused_DNC"));

  // NON-terminal / long-tail outcomes are NOT terminal (no invented policy).
  // NOTE: "scheduled" is handled separately below — it leaves the call list.
  for (const o of [
    "no_answer", "voicemail", "callback", "wrong_number", "busy", "hung_up",
    "mailbox_full", "disconnected", "not_interested", "moved", "wants_more_info",
    "will_think_about_it", "language_barrier", "reached",
    "manager_review", "needs_records", "",
  ]) {
    assert.equal(resolveTerminalExecutionState(o), null, `${o} must NOT be terminal`);
  }

  // "scheduled" LEAVES the active call list but is a DISTINCT reason (not
  // archive-terminal): engagementStatus="scheduled" (excluded by BOTH
  // eligibility reads via NON_CALLABLE_ENGAGEMENT_STATUSES) with the lifecycle
  // kept "active" (the visit is still ahead). It does NOT fabricate an
  // appointment row — the canonical scheduling path still owns that — it only
  // removes the case from ordinary outbound calling instead of leaving it
  // callable ("contacted"). Regression guard for the P0 #4 "scheduled →
  // contacted → still callable" leak.
  {
    const s = resolveTerminalExecutionState("scheduled");
    assert.ok(s, "scheduled resolves a non-callable state (not null)");
    assert.equal(s!.engagementStatus, "scheduled", "scheduled → engagementStatus scheduled");
    assert.equal(s!.lifecycleStatus, "active", "scheduled → lifecycleStatus stays active");
  }
  assert.equal(
    resolveTerminalExecutionState("Scheduled")?.engagementStatus,
    "scheduled",
    "scheduled is case-insensitive",
  );

  // DNC outcome set (matches patient-directory DNC derivation).
  for (const o of ["refused_dnc", "dnc", "do_not_contact"]) {
    assert.ok(isDncOutcome(o), `${o} is DNC`);
    assert.ok(DNC_OUTCOMES.has(o));
  }
  for (const o of ["declined", "no_answer", "not_interested", "completed"]) {
    assert.equal(isDncOutcome(o), false, `${o} is NOT DNC`);
  }

  // DNC ⊆ negative-terminal (a refusal both closes the case AND blocks reentry).
  for (const o of DNC_OUTCOMES) {
    assert.ok(NEGATIVE_TERMINAL_OUTCOMES.has(o), `${o} DNC must be negative-terminal`);
  }
  assert.ok(!POSITIVE_TERMINAL_OUTCOMES.has("declined"));

  console.log("terminal + DNC classification test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
