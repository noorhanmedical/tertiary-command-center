import { describe, it } from "vitest";
// Ancillary qualification evidence — fixture verdict test (Bundle 41).
//
// Runnable via:
//   npx tsx server/repositories/__tests__/ancillaryQualificationEvidence-fixture.test.ts
//
// Imports the fixture (which runs its own top-level sanity checks),
// then runs verdict assertions on each of the four canned bundles.
//
// No DB. No app boot. No network. No PHI.

import {
  ANCILLARY_NAMES_FIXTURE,
  ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES,
  FIXTURE_BRAINWAVE_QUALIFIED,
  FIXTURE_FUTURE_ANCILLARY_NOT_QUALIFIED,
  FIXTURE_ULTRASOUND_EXCLUDED,
  FIXTURE_VITALWAVE_NEEDS_MORE_EVIDENCE,
  REVIEW_STATUSES_FIXTURE,
  SUGGESTED_STATUSES_FIXTURE,
  type AncillaryNameFixture,
} from "../../../tests/fixtures/ancillaryQualificationEvidence.fixture";

const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── §1: Ancillary names cover the documented set ─────────────────
check(
  ANCILLARY_NAMES_FIXTURE.length === 4,
  `§1: expected 4 ancillary names, got ${ANCILLARY_NAMES_FIXTURE.length}`,
);
for (const expected of ["brainwave", "vitalwave", "ultrasound", "future_ancillary_a"]) {
  check(
    (ANCILLARY_NAMES_FIXTURE as ReadonlyArray<string>).includes(expected),
    `§1: ancillary "${expected}" must be in the fixture`,
  );
}

// ─── §2: Suggested status + review status enums are pinned ────────
check(
  SUGGESTED_STATUSES_FIXTURE.length === 4,
  `§2: expected 4 suggested statuses, got ${SUGGESTED_STATUSES_FIXTURE.length}`,
);
check(
  REVIEW_STATUSES_FIXTURE.length === 4,
  `§2: expected 4 review statuses, got ${REVIEW_STATUSES_FIXTURE.length}`,
);

// ─── §3: BrainWave qualified bundle ───────────────────────────────
{
  const b = FIXTURE_BRAINWAVE_QUALIFIED;
  eq(b.ancillary, "brainwave", "§3: ancillary");
  eq(b.suggestedStatus, "qualified", "§3: suggestedStatus");
  check(b.supportingEvidence.length >= 1, "§3: must have supporting evidence");
  check(b.missingEvidence.length === 0, "§3: must have no missing evidence");
  check(b.exclusions.length === 0, "§3: must have no exclusions");
  eq(b.confidence.band, "high", "§3: confidence.band");
  eq(b.reviewStatus, "unreviewed", "§3: reviewStatus");
  eq(b.humanApprovalRequired, true, "§3: humanApprovalRequired");
  // Every supporting evidence entry carries a source reference.
  for (const e of b.supportingEvidence) {
    check(!!e.sourceReference, `§3: supporting evidence ${e.evidenceId} must carry a sourceReference`);
    check(
      !!e.sourceReference.rawPayloadPointer,
      `§3: supporting evidence ${e.evidenceId} sourceReference must carry rawPayloadPointer`,
    );
  }
}

// ─── §4: VitalWave needs-more-evidence bundle ────────────────────
{
  const b = FIXTURE_VITALWAVE_NEEDS_MORE_EVIDENCE;
  eq(b.ancillary, "vitalwave", "§4: ancillary");
  eq(b.suggestedStatus, "needs_more_evidence", "§4: suggestedStatus");
  check(b.missingEvidence.length >= 2, "§4: must enumerate >=2 missing evidence items");
  for (const m of b.missingEvidence) {
    check(
      m.reasonMissing === "not_present_in_store" ||
        m.reasonMissing === "present_but_stale" ||
        m.reasonMissing === "present_but_low_confidence" ||
        m.reasonMissing === "present_but_rejected" ||
        m.reasonMissing === "not_queryable_from_adapter",
      `§4: missing-evidence reason "${m.reasonMissing}" must be in the canonical set`,
    );
    check(
      typeof m.whereLooked === "string" && m.whereLooked.length > 0,
      `§4: missing-evidence whereLooked must be non-empty`,
    );
  }
  eq(b.confidence.band, "low", "§4: confidence.band capped at low for single-kind signal");
}

// ─── §5: Ultrasound excluded bundle ──────────────────────────────
{
  const b = FIXTURE_ULTRASOUND_EXCLUDED;
  eq(b.ancillary, "ultrasound", "§5: ancillary");
  eq(b.suggestedStatus, "excluded", "§5: suggestedStatus");
  check(b.exclusions.length >= 1, "§5: must enumerate >=1 exclusion");
  check(b.exclusions.includes("active_hospice_care"), "§5: must surface the contraindication");
  eq(b.humanApprovalRequired, true, "§5: excluded suggestions STILL require human review");
}

// ─── §6: Future-ancillary not-qualified bundle ────────────────────
{
  const b = FIXTURE_FUTURE_ANCILLARY_NOT_QUALIFIED;
  eq(b.ancillary, "future_ancillary_a", "§6: ancillary");
  eq(b.suggestedStatus, "not_qualified", "§6: suggestedStatus");
  check(b.supportingEvidence.length === 0, "§6: no supporting evidence");
  check(b.missingEvidence.length >= 1, "§6: must surface what was looked for");
}

// ─── §7: Every bundle carries the §11 envelope ────────────────────
const REQUIRED_ENVELOPE_KEYS: ReadonlyArray<string> = [
  "suggestionId",
  "ancillary",
  "canonicalPatientId",
  "tenantId",
  "suggestedStatus",
  "supportingEvidence",
  "missingEvidence",
  "exclusions",
  "sourceReferences",
  "confidence",
  "reviewStatus",
  "humanApprovalRequired",
];
for (const b of ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES) {
  for (const key of REQUIRED_ENVELOPE_KEYS) {
    check(
      key in (b as unknown as Record<string, unknown>),
      `§7: bundle ${b.suggestionId} must carry "${key}"`,
    );
  }
}

// ─── §8: humanApprovalRequired always true at emit time ───────────
for (const b of ANCILLARY_QUALIFICATION_FIXTURE_BUNDLES) {
  check(
    b.humanApprovalRequired === true,
    `§8: bundle ${b.suggestionId} must require human approval at emit time`,
  );
  check(
    b.reviewStatus === "unreviewed",
    `§8: bundle ${b.suggestionId} must emit with reviewStatus=unreviewed`,
  );
}

// ─── §9: Type-level probe — ancillary name is a string literal ────
const _typeProbe: AncillaryNameFixture = "brainwave";
void _typeProbe;

describe("Ancillary qualification evidence fixture test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Ancillary qualification evidence fixture test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
