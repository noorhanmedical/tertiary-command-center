// Canonical side-effect ownership matrix v2 — parity test (Batch G).

import {
  CALL_RESULT_SURFACES,
  CALL_RESULT_SIDE_EFFECTS,
  CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2,
  ownedSideEffects,
  suppressedSideEffects,
  type CallResultSideEffect,
} from "../../../../tests/fixtures/callResultCanonicalSideEffectOwnershipV2.fixture";
import { ENGAGEMENT_SUPPRESSED_STEPS } from "../recordCallResultEngagementExecutor";
import { OUTREACH_SUPPRESSED_STEPS } from "../recordCallResultOutreachExecutor";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) {
  if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
}

// §1 — Three surfaces.
eq(CALL_RESULT_SURFACES.length, 3, "§1: three surfaces");
check(CALL_RESULT_SURFACES.includes("engagement"), "§1: engagement");
check(CALL_RESULT_SURFACES.includes("outreach"), "§1: outreach");
check(CALL_RESULT_SURFACES.includes("team_portal_future"), "§1: team_portal_future");

// §2 — Eight side effects.
eq(CALL_RESULT_SIDE_EFFECTS.length, 8, "§2: eight side effects");

// §3 — Engagement-surface suppression matches the executor's
//      ENGAGEMENT_SUPPRESSED_STEPS list (single source of truth).
{
  const matrixSuppressed = suppressedSideEffects("engagement");
  for (const step of ENGAGEMENT_SUPPRESSED_STEPS) {
    check(
      (matrixSuppressed as ReadonlyArray<string>).includes(step),
      `§3: matrix engagement-suppressed list includes ${step}`,
    );
  }
  for (const step of matrixSuppressed) {
    check(
      (ENGAGEMENT_SUPPRESSED_STEPS as ReadonlyArray<string>).includes(step as never) ||
        // canonicalSpineEnsured is matrix-only; executor doesn't model it.
        step === "canonicalSpineEnsured",
      `§3: matrix engagement-suppressed step ${step} also in executor list`,
    );
  }
}

// §4 — Outreach-surface suppression matches OUTREACH_SUPPRESSED_STEPS.
{
  const matrixSuppressed = suppressedSideEffects("outreach");
  for (const step of OUTREACH_SUPPRESSED_STEPS) {
    check(
      (matrixSuppressed as ReadonlyArray<string>).includes(step),
      `§4: matrix outreach-suppressed list includes ${step}`,
    );
  }
}

// §5 — team_portal_future owns ALL non-out_of_band side effects.
{
  const row = CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2.team_portal_future;
  for (const se of CALL_RESULT_SIDE_EFFECTS) {
    const cell = row[se];
    check(
      cell === "owned" || cell === "out_of_band",
      `§5: team_portal_future ${se} must be 'owned' or 'out_of_band' (got ${cell})`,
    );
  }
}

// §6 — canonicalSpineEnsured: engagement is future, outreach is out_of_band.
eq(
  CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2.engagement.canonicalSpineEnsured,
  "future",
  "§6: engagement canonicalSpineEnsured is future",
);
eq(
  CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2.outreach.canonicalSpineEnsured,
  "out_of_band",
  "§6: outreach canonicalSpineEnsured is out_of_band",
);

// §7 — Every cell is one of the four canonical values.
{
  const allowed = new Set(["owned", "suppressed", "future", "out_of_band"]);
  for (const surface of CALL_RESULT_SURFACES) {
    const row = CALL_RESULT_SIDE_EFFECT_OWNERSHIP_V2[surface];
    for (const se of CALL_RESULT_SIDE_EFFECTS) {
      check(allowed.has(row[se]), `§7: ${surface}.${se} = ${row[se]} not in canonical set`);
    }
  }
}

// §8 — ownedSideEffects helper.
{
  const engOwned = ownedSideEffects("engagement");
  check(engOwned.includes("journeyEventAppended"), "§8: engagement owns journey");
  check(engOwned.includes("executionCaseUpdated"), "§8: engagement owns exec-case");
  check(!engOwned.includes("outreachCallCreated"), "§8: engagement does NOT own outreach insert");
}

if (failures.length > 0) {
  console.error("Side-effect ownership v2 test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Side-effect ownership v2 test passed.");
