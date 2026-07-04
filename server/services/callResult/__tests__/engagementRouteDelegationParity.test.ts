import { describe, it } from "vitest";
// Engagement route delegation parity harness (Batch 4 of Engagement
// completion run).
//
// Drives legacy-shaped engagement inputs through the engagement
// executor + closure-capturing fake deps that mimic the legacy route's
// writer calls. Asserts:
//   - the rebuilt response envelope matches the legacy 6-key shape;
//   - Journey Event row shape preserved;
//   - executionCase row shape preserved;
//   - triage row shape preserved for triage-required outcomes;
//   - task row shape preserved for task-required outcomes;
//   - ownershipUpdated preserved;
//   - coarse engagementStatus mode collapses non-terminal to in_progress
//     for every outcome that hits the EC update step;
//   - terminal outcomes (scheduled / declined) keep canonical contacted.

import {
  recordEngagementCallResult,
  type EngagementCallResultInput,
} from "../recordCallResultEngagementExecutor";
import type {
  CallResultExecutionDependencies,
  UpdateExecutionCaseEngagementArgs,
  UpsertTriageCaseArgs,
  CreateFollowUpTaskArgs,
  AppendJourneyEventArgs,
} from "../recordCallResultExecutionAdapter";
import { CALL_RESULT_PARITY_FIXTURE } from "../../../../tests/fixtures/callResultCanonicalization.fixture";
import {
  ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS,
  type EngagementCallResultResponseKey,
} from "../../../../tests/fixtures/engagementCallResultResponseShape.fixture";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) {
  if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
}

type FakeJourneyRow = { id: string; eventType: string; sourceSurface: string; outcome: string };
type FakeExecCaseRow = { id: string; engagementStatus: string | null; nextActionAt: Date | null };
type FakeTriageRow = { id: string; mainType: string | null; subtype: string | null; priority: string | null };
type FakeTaskRow = { id: string; title: string | null; priority: string | null; urgency: string | null };

const CANONICAL_OUTCOMES = [
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
] as const;

const TERMINAL_OUTCOMES = new Set<string>(["scheduled", "declined"]);

function makeCapturingDeps(): {
  deps: CallResultExecutionDependencies;
  captured: {
    journeyEvent: FakeJourneyRow | null;
    executionCase: FakeExecCaseRow | null;
    triageCase: FakeTriageRow | null;
    task: FakeTaskRow | null;
    ownershipUpdated: boolean;
  };
} {
  const captured = {
    journeyEvent: null as FakeJourneyRow | null,
    executionCase: null as FakeExecCaseRow | null,
    triageCase: null as FakeTriageRow | null,
    task: null as FakeTaskRow | null,
    ownershipUpdated: false,
  };
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: () => {
      // engagement-suppressed
    },
    updateAppointmentStatus: () => {
      // engagement-suppressed
    },
    markAssignmentCompleted: () => {
      // engagement-suppressed
    },
    appendJourneyEvent: (args: AppendJourneyEventArgs) => {
      captured.journeyEvent = {
        id: "je-fake",
        eventType: args.eventType,
        sourceSurface: args.sourceSurface,
        outcome: args.outcome,
      };
    },
    updateExecutionCaseEngagement: (args: UpdateExecutionCaseEngagementArgs) => {
      captured.executionCase = {
        id: "ec-fake",
        engagementStatus: args.engagementStatus,
        nextActionAt: args.nextActionAt,
      };
      if (args.assignedTeamMemberId != null) {
        captured.ownershipUpdated = true;
      }
    },
    upsertTriageCase: (args: UpsertTriageCaseArgs) => {
      captured.triageCase = {
        id: "tc-fake",
        mainType: args.mainType ?? null,
        subtype: args.subtype ?? null,
        priority: args.priority ?? null,
      };
    },
    createFollowUpTask: (args: CreateFollowUpTaskArgs) => {
      captured.task = {
        id: "tk-fake",
        title: args.title ?? null,
        priority: args.priority ?? null,
        urgency: args.urgency ?? null,
      };
    },
  };
  return { deps, captured };
}

// §1 — Every canonical outcome can rebuild the legacy 6-key envelope.
for (const outcome of CANONICAL_OUTCOMES) {
  const fixtureEntry = CALL_RESULT_PARITY_FIXTURE.find((e) => e.outcome === outcome);
  check(!!fixtureEntry, `§1[${outcome}]: fixture entry exists`);
  if (!fixtureEntry) continue;

  const { deps, captured } = makeCapturingDeps();
  const input: EngagementCallResultInput = {
    patientScreeningId: "ps-parity",
    patientExecutionCaseId: "ec-parity",
    outcome,
    callbackAt: fixtureEntry.executionCaseNextActionAtRequired
      ? "2026-06-12T10:00:00.000Z"
      : null,
    assignedTeamMemberId: "tm-99",
    assignedRole: "scheduler",
    forceReassign: false,
    journeyEventMetadata: { callDisposition: "ok", facilityId: "f-1" },
    patientName: "Parity Patient",
    patientDob: "1985-05-15",
    triageMainType: "callback",
    triageSubtype: "patient_requested_call_later",
    triagePriority: outcome === "manager_review" ? "high" : "normal",
    triageAssignedUserId: "u-1",
    triageNote: "test note",
    taskTitle: `Call result needs follow-up — ${outcome}`,
    taskDescription: "test description",
    taskPriority: outcome === "manager_review" ? "high" : "normal",
    taskUrgency: "EOD",
    taskAssignedToUserId: "u-1",
  };
  const r = await recordEngagementCallResult(input, deps, {
    callbackHours: 24,
    engagementStatusSemantics: "coarse",
  });

  // §1.shape — rebuild legacy envelope.
  const legacyEnvelope: Record<EngagementCallResultResponseKey, unknown> = {
    ok: r.ok,
    executionCase: captured.executionCase,
    journeyEvent: captured.journeyEvent,
    triageCase: captured.triageCase,
    task: captured.task,
    ownershipUpdated: captured.ownershipUpdated || r.ownershipUpdated,
  };
  for (const key of ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS) {
    check(key in legacyEnvelope, `§1.shape[${outcome}] key "${key}" present`);
  }

  // §1.ok — always true on the parity path.
  eq(legacyEnvelope.ok, true, `§1.ok[${outcome}]`);

  // §1.journey — Journey Event row shape preserved.
  check(captured.journeyEvent !== null, `§1.journey[${outcome}] row present`);
  if (captured.journeyEvent) {
    eq(captured.journeyEvent.eventType, "call_result_logged", `§1.journey[${outcome}] eventType`);
    eq(captured.journeyEvent.outcome, outcome, `§1.journey[${outcome}] outcome echo`);
    eq(captured.journeyEvent.sourceSurface, "engagement_center_route", `§1.journey[${outcome}] surface`);
  }

  // §1.ec — execution-case row shape preserved.
  check(captured.executionCase !== null, `§1.ec[${outcome}] row present`);
  if (captured.executionCase) {
    if (TERMINAL_OUTCOMES.has(outcome)) {
      // Terminal: contacted preserved under both modes.
      eq(captured.executionCase.engagementStatus, "contacted", `§1.ec[${outcome}] terminal contacted`);
    } else {
      // Non-terminal: coarse → in_progress.
      eq(captured.executionCase.engagementStatus, "in_progress", `§1.ec[${outcome}] non-terminal collapsed`);
    }
  }

  // §1.triage — triage row shape preserved when expected.
  if (fixtureEntry.triageCaseRequired) {
    check(captured.triageCase !== null, `§1.triage[${outcome}] row present when required`);
    if (captured.triageCase) {
      eq(captured.triageCase.mainType, "callback", `§1.triage[${outcome}] mainType forwarded`);
      eq(captured.triageCase.subtype, "patient_requested_call_later", `§1.triage[${outcome}] subtype forwarded`);
    }
  } else {
    check(captured.triageCase === null, `§1.triage[${outcome}] row null when not required`);
  }

  // §1.task — task row shape preserved when expected.
  if (fixtureEntry.followUpTaskRequired) {
    check(captured.task !== null, `§1.task[${outcome}] row present when required`);
    if (captured.task) {
      eq(captured.task.title, `Call result needs follow-up — ${outcome}`, `§1.task[${outcome}] title`);
      eq(captured.task.urgency, "EOD", `§1.task[${outcome}] urgency`);
    }
  } else {
    check(captured.task === null, `§1.task[${outcome}] row null when not required`);
  }

  // §1.ownership — ownershipUpdated preserved (planned=true; EC step ran).
  eq(legacyEnvelope.ownershipUpdated, true, `§1.ownership[${outcome}] updated`);
}

// §2 — Without ownership input, ownershipUpdated stays false.
{
  const { deps, captured } = makeCapturingDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps-no-own",
      patientExecutionCaseId: "ec-no-own",
      outcome: "callback",
      callbackAt: "2026-06-12T10:00:00.000Z",
    },
    deps,
    { callbackHours: 24, engagementStatusSemantics: "coarse" },
  );
  eq(captured.ownershipUpdated, false, "§2: no ownership input → captured stays false");
  eq(r.ownershipPlanned, false, "§2: ownershipPlanned false");
  eq(r.ownershipUpdated, false, "§2: ownershipUpdated false");
}

describe("Engagement route delegation parity", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Engagement route delegation parity failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
