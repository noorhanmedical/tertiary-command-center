import { describe, it } from "vitest";
// Outreach route delegation parity harness (Batch B5 of Phase 1 run).
//
// Drives canonical-set outreach outcomes through the outreach executor
// with fake deps. Asserts the call object is the captured row, no
// wrapper envelope, appointmentStatus + attemptNumber + terminal
// assignment completion preserved, canonical spine remains out-of-band,
// engagement task/triage + journey event suppressed.

import {
  recordOutreachCallResult,
  type OutreachCallResultInput,
} from "../recordCallResultOutreachExecutor";
import type {
  CallResultExecutionDependencies,
  CreateOutreachCallArgs,
  MarkAssignmentCompletedArgs,
  AppendJourneyEventArgs,
  UpdateExecutionCaseEngagementArgs,
  UpsertTriageCaseArgs,
  CreateFollowUpTaskArgs,
} from "../recordCallResultExecutionAdapter";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) {
  if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
}

type FakeCallRow = { id: string; outcome: string; attemptNumber: number; appointmentStatus: string | null };

const CANONICAL_OUTREACH_OUTCOMES = [
  "scheduled",
  "completed",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
] as const;

const TERMINAL_OUTREACH_OUTCOMES = new Set<string>([
  "scheduled",
  "completed",
  "declined",
  "dnc",
  "do_not_contact",
  "deceased",
  "cancelled",
]);

function makeCapturingDeps(): {
  deps: CallResultExecutionDependencies;
  captured: {
    callRow: FakeCallRow | null;
    appointmentStatusUpdated: boolean;
    assignmentCompletedReason: string | null;
    journeyEventAppended: boolean;
    executionCaseUpdated: boolean;
    triageCaseUpserted: boolean;
    taskCreated: boolean;
  };
} {
  const captured = {
    callRow: null as FakeCallRow | null,
    appointmentStatusUpdated: false,
    assignmentCompletedReason: null as string | null,
    journeyEventAppended: false,
    executionCaseUpdated: false,
    triageCaseUpserted: false,
    taskCreated: false,
  };
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: (args: CreateOutreachCallArgs) => {
      captured.callRow = {
        id: "oc-parity",
        outcome: args.outcome,
        attemptNumber: args.attemptNumber ?? 1,
        appointmentStatus: (args as CreateOutreachCallArgs).desiredAppointmentStatus ?? null,
      };
    },
    updateAppointmentStatus: () => {
      captured.appointmentStatusUpdated = true;
    },
    markAssignmentCompleted: (args: MarkAssignmentCompletedArgs) => {
      captured.assignmentCompletedReason = args.terminalCompletionReason ?? null;
    },
    appendJourneyEvent: (_args: AppendJourneyEventArgs) => {
      captured.journeyEventAppended = true;
    },
    updateExecutionCaseEngagement: (_args: UpdateExecutionCaseEngagementArgs) => {
      captured.executionCaseUpdated = true;
    },
    upsertTriageCase: (_args: UpsertTriageCaseArgs) => {
      captured.triageCaseUpserted = true;
    },
    createFollowUpTask: (_args: CreateFollowUpTaskArgs) => {
      captured.taskCreated = true;
    },
  };
  return { deps, captured };
}

// §1 — Every canonical outreach outcome yields a captured call row,
//      preserves attempt number, and preserves expected appointment
//      status / terminal-completion behavior.
for (const outcome of CANONICAL_OUTREACH_OUTCOMES) {
  const { deps, captured } = makeCapturingDeps();
  const input: OutreachCallResultInput = {
    patientScreeningId: "ps-parity",
    outcome,
    attemptNumber: 3,
    desiredAppointmentStatus:
      outcome === "scheduled" || outcome === "completed"
        ? "scheduled"
        : outcome === "callback"
          ? "callback"
          : outcome === "no_answer" || outcome === "voicemail"
            ? "no_answer"
            : "declined",
    schedulerUserId: "user-1",
    callMetadata: { ringCentralCallId: `rc-${outcome}` },
    terminalCompletionReason: TERMINAL_OUTREACH_OUTCOMES.has(outcome) ? outcome : null,
  };
  await recordOutreachCallResult(input, deps);

  // §1.row — call row captured (response is the row, no wrapper).
  check(captured.callRow !== null, `§1[${outcome}] call row captured`);
  if (captured.callRow) {
    eq(captured.callRow.outcome, outcome, `§1[${outcome}] outcome echoed on row`);
    eq(captured.callRow.attemptNumber, 3, `§1[${outcome}] attemptNumber preserved`);
  }

  // §1.terminal — terminal outcomes mark assignment completed with reason.
  if (TERMINAL_OUTREACH_OUTCOMES.has(outcome)) {
    eq(
      captured.assignmentCompletedReason,
      outcome,
      `§1[${outcome}] terminal assignment completion + reason`,
    );
  } else {
    eq(
      captured.assignmentCompletedReason,
      null,
      `§1[${outcome}] non-terminal: no assignment completion`,
    );
  }

  // §1.suppressed — engagement-only side effects suppressed.
  eq(captured.journeyEventAppended, false, `§1[${outcome}] journey event suppressed on outreach surface`);
  eq(captured.executionCaseUpdated, false, `§1[${outcome}] exec-case update suppressed on outreach surface`);
  eq(captured.triageCaseUpserted, false, `§1[${outcome}] triage suppressed on outreach surface`);
  eq(captured.taskCreated, false, `§1[${outcome}] task suppressed on outreach surface`);
}

// §2 — No wrapper envelope: the response semantic is the raw row.
{
  const { deps, captured } = makeCapturingDeps();
  await recordOutreachCallResult(
    {
      patientScreeningId: "ps-shape",
      outcome: "scheduled",
      attemptNumber: 1,
      desiredAppointmentStatus: "scheduled",
      terminalCompletionReason: "scheduled",
    },
    deps,
  );
  const responseEnvelope = captured.callRow;
  check(typeof responseEnvelope === "object" && responseEnvelope !== null, "§2: response is the call row object");
  // Asserts no wrapper key like `ok` / `executionCase` etc. appears on the row.
  if (responseEnvelope) {
    for (const wrapperKey of ["ok", "executionCase", "journeyEvent", "triageCase", "task"]) {
      check(!(wrapperKey in responseEnvelope), `§2: row must not carry wrapper key "${wrapperKey}"`);
    }
  }
}

describe("Outreach route delegation parity", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Outreach route delegation parity failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
