import { describe, it } from "vitest";
// Engagement side-effect matrix parity test (Batch 9).

import { ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX } from "../../../../tests/fixtures/engagementCallResultSideEffectMatrix.fixture";
import { CALL_RESULT_PARITY_FIXTURE } from "../../../../tests/fixtures/callResultCanonicalization.fixture";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) {
  if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
}

const canonicalByOutcome = new Map(CALL_RESULT_PARITY_FIXTURE.map((e) => [e.outcome, e]));

// §1 — Matrix matches canonical fixture per outcome (where both apply).
for (const m of ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX) {
  const c = canonicalByOutcome.get(m.outcome);
  check(!!c, `§1: outcome "${m.outcome}" must be in canonical fixture`);
  if (!c) continue;
  eq(m.journeyEventAppended, true, `§1.journey [${m.outcome}]`);
  eq(m.executionCaseEngagementStatus, c.executionCaseEngagementStatus, `§1.ecStatus [${m.outcome}]`);
  eq(m.executionCaseNextActionAt, c.executionCaseNextActionAtRequired, `§1.ecNextAction [${m.outcome}]`);
  eq(m.triageCaseUpserted, c.triageCaseRequired, `§1.triage [${m.outcome}]`);
  eq(m.followUpTaskCreated, c.followUpTaskRequired, `§1.task [${m.outcome}]`);
}

// §2 — engagement matrix has no outreach-owned side effects.
for (const m of ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX) {
  eq(m.assignmentCompletedOnEngagement, false, `§2.assignment [${m.outcome}] must be false on engagement`);
  eq(m.outreachCallCreatedOnEngagement, false, `§2.outreachCall [${m.outcome}] must be false on engagement`);
}

// §3 — Plexus IQ untouched note: matrix has no Plexus IQ surface.
{
  const json = JSON.stringify(ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX);
  check(!json.includes("plexusIq"), `§3: matrix must not include Plexus IQ surface`);
  check(!json.includes("PlexusIq"), `§3: matrix must not include Plexus IQ surface (capitalised)`);
}

describe("Engagement side-effect matrix test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Engagement side-effect matrix test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
