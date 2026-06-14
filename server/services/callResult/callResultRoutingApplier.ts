// callResultRoutingApplier — Phase 2 hardening item 2.
//
// Decides what to do with a routing plan when canonical writers
// exist. This module returns a typed `ApplicationOutcome` so the
// route handler can:
//   1. Apply the plan when writers exist (the route still owns the
//      actual DB call to the existing canonical writers).
//   2. Mark the plan `requires_writer = true` when no canonical
//      writer exists yet (honest pending — no fake DB write).
//
// Why honest pending? The route already invokes:
//   - upsertOpenSchedulingTriageCase
//   - storage.createTask
// for the canonical triage / task outcomes. PR 2.2 added an advisory
// routing plan; PR hardening 2 makes the plan and the route's own
// triage/task decisions converge so any future PR that switches to
// the plan-driven path stays byte-equivalent.

import type { CallResultRoutingPlan } from "./applyCallResultRouting";

export type RoutingWritersCapability = {
  /** Triage upsert is wired in the current handler. */
  triageWriter: boolean;
  /** Task creation is wired in the current handler. */
  taskWriter: boolean;
  /** A "close assignment" writer is wired (PR 2.4 covers schedule;
   *  the engagement assignment writer exists in engagementAssignmentBoard). */
  closeAssignmentWriter: boolean;
};

export type RoutingApplicationOutcome = {
  /** The next-action timestamp the route should set (already in the
   *  plan; surfaced here so the applier owns the contract). */
  nextActionAt: Date | null;
  /** Whether the route should open a triage case for this outcome. */
  openTriageCase: boolean;
  /** Whether the route should open a follow-up task. */
  openFollowUpTask: boolean;
  /** Whether the route should mark engagement as terminal-closed. */
  closeAssignment: boolean;
  /** Which fields are honestly pending (no writer wired yet) — the
   *  caller embeds this on the journey metadata so audits can find
   *  pending work. */
  requiresWriter: {
    triage: boolean;
    task: boolean;
    closeAssignment: boolean;
  };
};

const DEFAULT_CAPABILITIES: RoutingWritersCapability = {
  triageWriter: true,
  taskWriter: true,
  // The engagement assignment writer in
  // server/routes/engagementAssignmentBoard.ts can clear ownership,
  // but the call-result route handler does NOT currently call it
  // from the legacy disposition path. Until that wiring lands, we
  // mark close-assignment as honest pending.
  closeAssignmentWriter: false,
};

export function deriveRoutingApplication(
  plan: CallResultRoutingPlan,
  capabilities: RoutingWritersCapability = DEFAULT_CAPABILITIES,
): RoutingApplicationOutcome {
  const triageNeeded = plan.openTriageCase;
  const taskNeeded = plan.openFollowUpTask;
  const closeNeeded = plan.terminal;

  return {
    nextActionAt: plan.nextActionAt,
    openTriageCase: triageNeeded && capabilities.triageWriter,
    openFollowUpTask: taskNeeded && capabilities.taskWriter,
    closeAssignment: closeNeeded && capabilities.closeAssignmentWriter,
    requiresWriter: {
      triage: triageNeeded && !capabilities.triageWriter,
      task: taskNeeded && !capabilities.taskWriter,
      closeAssignment: closeNeeded && !capabilities.closeAssignmentWriter,
    },
  };
}
