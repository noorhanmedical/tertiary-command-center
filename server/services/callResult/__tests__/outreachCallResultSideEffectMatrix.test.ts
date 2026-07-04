import { describe, it } from "vitest";
// Outreach side-effect matrix parity test (Batch 16).

import { OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX } from "../../../../tests/fixtures/outreachCallResultSideEffectMatrix.fixture";
import { CALL_RESULT_PARITY_FIXTURE } from "../../../../tests/fixtures/callResultCanonicalization.fixture";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) { if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`); }

const canonicalByOutcome = new Map(CALL_RESULT_PARITY_FIXTURE.map((e) => [e.outcome, e]));

// §1 — Engagement-only side effects are explicitly false.
for (const m of OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX) {
  eq(m.journeyEventAppendedOnOutreach, false, `§1.journey [${m.outcome}] must be false`);
  eq(m.executionCaseUpdatedOnOutreach, false, `§1.ec [${m.outcome}] must be false`);
  eq(m.triageCaseUpsertedOnOutreach, false, `§1.triage [${m.outcome}] must be false`);
  eq(m.followUpTaskCreatedOnOutreach, false, `§1.task [${m.outcome}] must be false`);
}

// §2 — Outreach-owned side effects pinned.
for (const m of OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX) {
  eq(m.outreachCallCreated, true, `§2.outreach [${m.outcome}]`);
  eq(m.canonicalSpineSyncInvoked, true, `§2.spine [${m.outcome}]`);
}

// §3 — appointmentStatus map matches canonical fixture for shared outcomes.
for (const m of OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX) {
  const c = canonicalByOutcome.get(m.outcome);
  if (c) {
    eq(m.appointmentStatus, c.appointmentStatus, `§3.appt [${m.outcome}]`);
  }
}

// §4 — Terminal completion semantics match the outreach route's TERMINAL set.
{
  const TERMINAL = new Set(["scheduled", "completed", "declined", "dnc", "do_not_contact", "deceased", "cancelled"]);
  for (const m of OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX) {
    eq(m.outreachRouteTerminalCompletion, TERMINAL.has(m.outcome), `§4.terminal [${m.outcome}]`);
  }
}

// §5 — Plexus IQ untouched.
{
  const j = JSON.stringify(OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX);
  check(!j.includes("plexusIq"), "§5: matrix has no Plexus IQ");
  check(!j.includes("PlexusIq"), "§5: matrix has no PlexusIq");
}

describe("Outreach side-effect matrix test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Outreach side-effect matrix test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
