// Engagement delegation dry-run harness (Batch 11 of split-brain run).
//
// Proves that legacy-shaped engagement inputs can be threaded through
// the engagement executor + fake injected writers, and that the
// captured row returns can be reassembled into the legacy engagement
// response envelope (Batch 8 fixture).
//
// This is a HARNESS test — it does NOT make any route call. It shows
// that the future Batch 12 delegation can rebuild the response shape
// from the executor's output by using closure-based row capture in
// the dependency map.

import {
  recordEngagementCallResult,
  ENGAGEMENT_OWNED_STEPS,
} from "../recordCallResultEngagementExecutor";
import type {
  CallResultExecutionDependencies,
  CallResultExecutionStep,
} from "../recordCallResultExecutionAdapter";
import { isRecordCallResultEngagementDelegateEnabled } from "../recordCallResultEngagementDelegateFlag";
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

// Synthetic row shapes — opaque IDs only. NO PHI.
type FakeRow = { id: string; tag: string };

function makeCapturingDeps(): {
  deps: CallResultExecutionDependencies;
  captured: {
    executionCase: FakeRow | null;
    journeyEvent: FakeRow | null;
    triageCase: FakeRow | null;
    task: FakeRow | null;
    ownershipUpdated: boolean;
  };
} {
  const captured = {
    executionCase: null as FakeRow | null,
    journeyEvent: null as FakeRow | null,
    triageCase: null as FakeRow | null,
    task: null as FakeRow | null,
    ownershipUpdated: false,
  };
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: () => {
      // Engagement surface does not own outreach-call insert; this
      // step is a no-op when delegated from the engagement route in
      // the dry-run. (In Batch 14 the outreach surface will own it.)
    },
    appendJourneyEvent: () => {
      captured.journeyEvent = { id: "je-fake", tag: "journey_event_row" };
    },
    updateAppointmentStatus: () => {
      // Engagement route does not own appointment status today; no-op
      // in this dry-run.
    },
    updateExecutionCaseEngagement: () => {
      captured.executionCase = { id: "ec-fake", tag: "execution_case_row" };
      captured.ownershipUpdated = true;
    },
    markAssignmentCompleted: () => {
      // Engagement-route delegation in Batch 12 will not own assignment
      // completion. The fake is a no-op so the dry-run mirrors the
      // legacy split correctly.
    },
    upsertTriageCase: () => {
      captured.triageCase = { id: "tc-fake", tag: "triage_case_row" };
    },
    createFollowUpTask: () => {
      captured.task = { id: "tk-fake", tag: "task_row" };
    },
  };
  return { deps, captured };
}

// §1 — Flag accessor exists and defaults OFF.
{
  const before = process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE;
  delete process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE;
  eq(isRecordCallResultEngagementDelegateEnabled(), false, "§1: flag default OFF");
  process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE = "1";
  eq(isRecordCallResultEngagementDelegateEnabled(), true, "§1: flag truthy '1'");
  process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE = "yes";
  eq(isRecordCallResultEngagementDelegateEnabled(), true, "§1: flag truthy 'yes'");
  process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE = "no";
  eq(isRecordCallResultEngagementDelegateEnabled(), false, "§1: flag falsy 'no'");
  if (before === undefined) delete process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE;
  else process.env.USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE = before;
}

// §2 — Every fixture outcome can rebuild a legacy-shaped response
//      envelope from captured rows.
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  const { deps, captured } = makeCapturingDeps();
  const result = await recordEngagementCallResult(
    {
      patientScreeningId: "ps-dryrun",
      patientExecutionCaseId: "ec-dryrun",
      outcome: env.outcome,
      callbackAt: env.executionCaseNextActionAtRequired
        ? "2026-06-10T18:00:00.000Z"
        : null,
    },
    deps,
  );

  // Rebuild the legacy engagement response envelope.
  const legacyEnvelope: Record<EngagementCallResultResponseKey, unknown> = {
    ok: result.ok,
    executionCase: captured.executionCase,
    journeyEvent: captured.journeyEvent,
    triageCase: captured.triageCase,
    task: captured.task,
    ownershipUpdated: captured.ownershipUpdated,
  };

  // §2.a — Every key from the response-shape fixture is present.
  for (const key of ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS) {
    check(key in legacyEnvelope, `§2.a [${env.outcome}] key "${key}" present in rebuilt envelope`);
  }

  // §2.b — Conditional rows match the canonical envelope.
  eq(legacyEnvelope.ok, true, `§2.b [${env.outcome}] ok`);
  // executionCase captured iff planner emits an engagement-status transition.
  eq(
    legacyEnvelope.executionCase !== null,
    env.executionCaseEngagementStatus !== null,
    `§2.b [${env.outcome}] executionCase presence`,
  );
  // triageCase captured iff fixture says triage required.
  eq(
    legacyEnvelope.triageCase !== null,
    env.triageCaseRequired,
    `§2.b [${env.outcome}] triageCase presence`,
  );
  // task captured iff fixture says task required.
  eq(
    legacyEnvelope.task !== null,
    env.followUpTaskRequired,
    `§2.b [${env.outcome}] task presence`,
  );
  // journeyEvent always captured.
  eq(legacyEnvelope.journeyEvent !== null, true, `§2.b [${env.outcome}] journeyEvent presence`);
}

// §2.5 — Suppression confirms outreach/assignment steps don't
//        execute on engagement surface.
{
  const { deps, captured } = makeCapturingDeps();
  const result = await recordEngagementCallResult(
    {
      patientScreeningId: "ps-dryrun",
      patientExecutionCaseId: "ec-dryrun",
      outcome: "scheduled",
    },
    deps,
  );
  // captured.outreachCallCreated would be true if dep was invoked,
  // but the dep is a no-op so we inspect the step list instead.
  const outreachStep = result.steps.find((s) => s.step === "outreachCallCreated");
  const assignStep = result.steps.find((s) => s.step === "assignmentCompleted");
  check(outreachStep?.status === "skipped", "§2.5: outreach step skipped on engagement");
  check(outreachStep?.reason === "surface does not own", "§2.5: outreach reason canonical");
  check(assignStep?.status === "skipped", "§2.5: assignment step skipped on engagement");
  check(assignStep?.reason === "surface does not own", "§2.5: assignment reason canonical");
  // ownershipUpdated captured by execution case dep still works.
  eq(captured.ownershipUpdated, true, "§2.5: ownershipUpdated still captured");
}

// §2.6 — Ownership write-through populates the legacy envelope's
//        ownershipUpdated boolean directly from the executor
//        response (Batch 2 of arg-extensions run).
{
  const { deps } = makeCapturingDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps-dryrun",
      patientExecutionCaseId: "ec-dryrun",
      outcome: "scheduled",
      assignedTeamMemberId: "tm-99",
      forceReassign: true,
    },
    deps,
  );
  eq(r.ownershipPlanned, true, "§2.6: ownershipPlanned true");
  eq(r.ownershipUpdated, true, "§2.6: ownershipUpdated true when EC step ran");
  // The legacy envelope now derives ownershipUpdated DIRECTLY from
  // the executor response (was: captured side-effect proxy in the
  // makeCapturingDeps closure).
  const legacy = {
    ok: r.ok,
    ownershipUpdated: r.ownershipUpdated,
  };
  eq(legacy.ownershipUpdated, true, "§2.6: legacy envelope ownershipUpdated from executor");
}

// §2.7 — Journey-event metadata + PHI threaded through DI without
//        passing through the canonical surface (Batch 3 of arg
//        extensions).
{
  const { deps, captured } = makeCapturingDeps();
  // Extend the capturing dep to also capture metadata + PHI.
  let capturedJourneyMeta: Record<string, unknown> | undefined;
  let capturedPatientName: string | null | undefined;
  let capturedPatientDob: string | null | undefined;
  const wrappedDeps = {
    ...deps,
    appendJourneyEvent: (args: Record<string, unknown>) => {
      capturedJourneyMeta = args.metadata as Record<string, unknown> | undefined;
      capturedPatientName = args.patientName as string | null | undefined;
      capturedPatientDob = args.patientDob as string | null | undefined;
      captured.journeyEvent = { id: "je-fake", tag: "journey_event_row" };
    },
  };
  await recordEngagementCallResult(
    {
      patientScreeningId: "ps-dryrun",
      patientExecutionCaseId: "ec-dryrun",
      outcome: "scheduled",
      journeyEventMetadata: { callDisposition: "ok", facilityId: "f-1" },
      patientName: "DryRun Patient",
      patientDob: "1990-01-01",
    },
    wrappedDeps,
  );
  check(capturedJourneyMeta?.callDisposition === "ok", "§2.7: dry-run captured journey metadata");
  check(capturedPatientName === "DryRun Patient", "§2.7: dry-run captured patientName via DI");
  check(capturedPatientDob === "1990-01-01", "§2.7: dry-run captured patientDob via DI");
}

// §3 — Engagement-owned step list is what the delegated route should
//      surface. The dry-run uses this list to filter the executor's
//      step results before rebuilding the legacy envelope.
{
  const steps: ReadonlyArray<CallResultExecutionStep> = ENGAGEMENT_OWNED_STEPS;
  check(steps.includes("journeyEventAppended"), "§3: engagement-owned includes journeyEventAppended");
  check(steps.includes("executionCaseUpdated"), "§3: engagement-owned includes executionCaseUpdated");
  check(steps.includes("triageCaseUpserted"), "§3: engagement-owned includes triageCaseUpserted");
  check(steps.includes("followUpTaskCreated"), "§3: engagement-owned includes followUpTaskCreated");
}

if (failures.length > 0) {
  console.error("Engagement delegate dry-run FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegate dry-run passed.");
