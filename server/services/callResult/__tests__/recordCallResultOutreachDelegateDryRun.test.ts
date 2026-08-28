// Outreach delegation dry-run harness (Batch 18 of split-brain run).

import {
  recordOutreachCallResult,
  OUTREACH_OWNED_STEPS,
  OUTREACH_SUPPRESSED_STEPS,
} from "../recordCallResultOutreachExecutor";
import type { CallResultExecutionDependencies } from "../recordCallResultExecutionAdapter";
import { isRecordCallResultOutreachDelegateEnabled } from "../recordCallResultOutreachDelegateFlag";
import { CALL_RESULT_PARITY_FIXTURE } from "../../../../tests/fixtures/callResultCanonicalization.fixture";
import { OUTREACH_CALL_RESULT_RESPONSE_CONTRACT } from "../../../../tests/fixtures/outreachCallResultResponseShape.fixture";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) { if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`); }

// §1 — Flag accessor defaults ON (canonical convergence), with
// explicit opt-out and global rollback overrides.
{
  const before = process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE;
  const beforeRb = process.env.LEGACY_CALL_RESULT_ROLLBACK;
  delete process.env.LEGACY_CALL_RESULT_ROLLBACK;
  delete process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE;
  eq(isRecordCallResultOutreachDelegateEnabled(), true, "§1: default ON");
  process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE = "1";
  eq(isRecordCallResultOutreachDelegateEnabled(), true, "§1: '1' truthy");
  process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE = "yes";
  eq(isRecordCallResultOutreachDelegateEnabled(), true, "§1: 'yes' truthy");
  process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE = "no";
  eq(isRecordCallResultOutreachDelegateEnabled(), false, "§1: explicit opt-out 'no'");
  process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE = "0";
  eq(isRecordCallResultOutreachDelegateEnabled(), false, "§1: explicit opt-out '0'");
  // Global rollback wins over the default-ON.
  delete process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE;
  process.env.LEGACY_CALL_RESULT_ROLLBACK = "1";
  eq(isRecordCallResultOutreachDelegateEnabled(), false, "§1: global rollback wins");
  delete process.env.LEGACY_CALL_RESULT_ROLLBACK;
  if (before === undefined) delete process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE;
  else process.env.USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE = before;
  if (beforeRb === undefined) delete process.env.LEGACY_CALL_RESULT_ROLLBACK;
  else process.env.LEGACY_CALL_RESULT_ROLLBACK = beforeRb;
}

// Synthetic raw outreach_calls row shape — the future route delegation
// will return THIS row from the captured createOutreachCall dep.
type RawOutreachCallRow = {
  id: string;
  patientScreeningId: string;
  outcome: string;
  attemptNumber: number;
  durationSeconds: number | null;
  notes: string | null;
};

function makeCapturingOutreachDeps(): {
  deps: CallResultExecutionDependencies;
  captured: { outreachCall: RawOutreachCallRow | null };
} {
  const captured: { outreachCall: RawOutreachCallRow | null } = { outreachCall: null };
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: (args) => {
      // The captured row mimics what storage.createOutreachCallAtomic
      // would return. Notes/duration/attemptNumber are forwarded as-is.
      captured.outreachCall = {
        id: "oc-dryrun",
        patientScreeningId: args.patientScreeningId,
        outcome: args.outcome,
        attemptNumber: args.attemptNumber ?? 1,
        durationSeconds: args.durationSeconds,
        notes: args.notes,
      };
    },
    // Outreach surface does NOT own these — the route's no-op deps
    // mirror the legacy split.
    appendJourneyEvent: () => {},
    updateAppointmentStatus: () => {
      // Outreach route owns appointment status via the atomic helper;
      // the dry-run treats it as a no-op here because the helper
      // already wrote it inside createOutreachCall in production.
    },
    updateExecutionCaseEngagement: () => {},
    markAssignmentCompleted: () => {},
    upsertTriageCase: () => {},
    createFollowUpTask: () => {},
  };
  return { deps, captured };
}

// §2 — Every canonical-set outcome the outreach route accepts can
//      produce a raw row response.
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  // The outreach route's schema accepts outcomes from the OutreachCallOutcome
  // enum. We use only the overlap with the canonical-set here.
  if (!["scheduled", "callback", "no_answer", "voicemail", "wrong_number", "declined"].includes(env.outcome)) {
    continue;
  }
  const { deps, captured } = makeCapturingOutreachDeps();
  const r = await recordOutreachCallResult(
    {
      patientScreeningId: "ps-dryrun",
      outcome: env.outcome,
      callbackAt: env.executionCaseNextActionAtRequired ? "2026-06-10T18:00:00.000Z" : null,
      durationSeconds: 42,
      notes: "test note (non-PHI)",
      attemptNumber: 3,
    },
    deps,
  );

  eq(r.ok, true, `§2.ok [${env.outcome}]`);
  // Captured row exists.
  check(captured.outreachCall !== null, `§2.captured [${env.outcome}]`);
  if (captured.outreachCall) {
    eq(captured.outreachCall.outcome, env.outcome, `§2.outcome [${env.outcome}]`);
    eq(captured.outreachCall.attemptNumber, 3, `§2.attempt [${env.outcome}]`);
  }
}

// §2.5 — Suppressed steps appear as skipped with the canonical reason.
{
  const { deps } = makeCapturingOutreachDeps();
  const r = await recordOutreachCallResult(
    { patientScreeningId: "ps", outcome: "scheduled" },
    deps,
  );
  for (const stepName of OUTREACH_SUPPRESSED_STEPS) {
    const stepResult = r.steps.find((s) => s.step === stepName);
    check(stepResult?.status === "skipped", `§2.5: ${stepName} skipped on outreach surface`);
    check(stepResult?.reason === "surface does not own", `§2.5: ${stepName} canonical reason`);
  }
}

// §3 — Outreach-owned steps still pinned.
check(
  OUTREACH_OWNED_STEPS.includes("outreachCallCreated"),
  "§3: outreach-owned includes outreachCallCreated",
);
check(
  OUTREACH_OWNED_STEPS.includes("assignmentCompleted"),
  "§3: outreach-owned includes assignmentCompleted",
);

// §4 — Response-shape contract still says raw_row, 201, no wrapper.
eq(OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.httpStatus, 201, "§4: 201 status");
eq(OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.envelope, "raw_row", "§4: raw_row envelope");

if (failures.length > 0) {
  console.error("Outreach delegate dry-run FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach delegate dry-run passed.");
