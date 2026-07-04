import { describe, it } from "vitest";
// Engagement response-shape parity test (Batch 8).

import {
  ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS,
  ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY,
  ENGAGEMENT_CALL_RESULT_SUPPORTED_OUTCOMES,
} from "../../../../tests/fixtures/engagementCallResultResponseShape.fixture";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }

// §1 — Exactly six keys.
check(
  ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS.length === 6,
  `§1: expected 6 keys, got ${ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS.length}`,
);

// §2 — Every key from the legacy response is present.
const expected = ["ok", "executionCase", "journeyEvent", "triageCase", "task", "ownershipUpdated"];
for (const k of expected) {
  check(
    (ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS as ReadonlyArray<string>).includes(k),
    `§2: key "${k}" must be in fixture`,
  );
}

// §3 — Nullability annotations are present + correct.
check(ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY.ok === "always", `§3.ok always`);
check(ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY.ownershipUpdated === "always", `§3.ownership always`);
check(ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY.executionCase === "nullable", `§3.execCase nullable`);
check(ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY.journeyEvent === "nullable", `§3.journey nullable`);
check(ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY.triageCase === "nullable", `§3.triage nullable`);
check(ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY.task === "nullable", `§3.task nullable`);

// §4 — Supported outcomes match the canonical 10.
check(
  ENGAGEMENT_CALL_RESULT_SUPPORTED_OUTCOMES.length === 10,
  `§4: expected 10 supported outcomes, got ${ENGAGEMENT_CALL_RESULT_SUPPORTED_OUTCOMES.length}`,
);

describe("Engagement response-shape test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Engagement response-shape test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
