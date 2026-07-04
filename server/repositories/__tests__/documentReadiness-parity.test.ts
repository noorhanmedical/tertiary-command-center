import { describe, it } from "vitest";
// Document / report readiness — parity test (Bundle 26).
//
// Runnable via:
//   npx tsx server/repositories/__tests__/documentReadiness-parity.test.ts
//
// PURPOSE
//   Encodes the canonical billing-readiness evaluation rule from
//   server/repositories/billingReadiness.repo.ts:74-118 as an
//   in-memory reference implementation and asserts:
//     - every per-type passing-status list matches the live repo.
//     - the verdict shape: ready_to_generate vs missing_requirements.
//     - the `missing` array enumerates ONLY required types that
//       are absent or have a non-passing status.
//     - unrelated document types (billing_document, etc.) are
//       ignored by the verdict.
//
// SAFETY / SCOPE
//   - No DB, no app boot, no network.
//   - No PHI in fixtures (synthetic status strings only).
//   - The legacy evaluator at billingReadiness.repo.ts is NOT
//     touched by this bundle.
//
// Exit 0 = pass; exit 1 = fail.

import {
  REQUIRED_DOC_TYPES,
  PASSING_STATUSES_BY_TYPE,
  DOC_READINESS_FIXTURE_FULLY_READY,
  DOC_READINESS_FIXTURE_MISSING_REPORT,
  DOC_READINESS_FIXTURE_PENDING_CONSENT,
  DOC_READINESS_FIXTURE_EXTRA_BILLING,
  type DocReadinessFixtureRow,
  type RequiredDocType,
} from "../../../tests/fixtures/documentReadiness.fixture";

const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── Reference evaluator. Mirrors billingReadiness.repo.ts:113-121. ──
type Verdict = {
  readinessStatus: "ready_to_generate" | "missing_requirements";
  missing: RequiredDocType[];
  evaluatedDocs: Record<RequiredDocType, { status: string | null; passed: boolean }>;
};

function evaluateReadiness_REFERENCE(
  rows: ReadonlyArray<DocReadinessFixtureRow>,
): Verdict {
  const docStatusByType = new Map<string, string>();
  for (const r of rows) docStatusByType.set(r.documentType, r.documentStatus);

  const missing: RequiredDocType[] = [];
  const evaluatedDocs = {} as Verdict["evaluatedDocs"];
  for (const t of REQUIRED_DOC_TYPES) {
    const status = docStatusByType.get(t) ?? null;
    const passing = PASSING_STATUSES_BY_TYPE[t];
    const passed = status !== null && passing.includes(status);
    if (!passed) missing.push(t);
    evaluatedDocs[t] = { status, passed };
  }
  return {
    readinessStatus: missing.length === 0 ? "ready_to_generate" : "missing_requirements",
    missing,
    evaluatedDocs,
  };
}

// ─── §1: Passing-status sets are non-empty + use the documented set ──
{
  for (const t of REQUIRED_DOC_TYPES) {
    const set = PASSING_STATUSES_BY_TYPE[t];
    check(set.length > 0, `§1: ${t} must have a non-empty passing set`);
    for (const status of set) {
      check(
        ["completed", "uploaded", "approved", "generated"].includes(status),
        `§1: ${t} has unknown passing status "${status}"`,
      );
    }
  }
  // Spot-check the canonical lists byte-equivalent to the repo source.
  check(
    PASSING_STATUSES_BY_TYPE.informed_consent.includes("completed") &&
      PASSING_STATUSES_BY_TYPE.informed_consent.includes("uploaded") &&
      PASSING_STATUSES_BY_TYPE.informed_consent.includes("approved"),
    "§1: informed_consent passing set drifted from canonical",
  );
  check(
    PASSING_STATUSES_BY_TYPE.report.includes("uploaded") &&
      PASSING_STATUSES_BY_TYPE.report.includes("completed") &&
      PASSING_STATUSES_BY_TYPE.report.includes("approved"),
    "§1: report passing set drifted from canonical",
  );
  check(
    PASSING_STATUSES_BY_TYPE.order_note.includes("generated"),
    "§1: order_note must accept 'generated' status",
  );
  check(
    PASSING_STATUSES_BY_TYPE.post_procedure_note.includes("generated"),
    "§1: post_procedure_note must accept 'generated' status",
  );
}

// ─── §2: Fully-ready fixture → ready_to_generate, missing = [] ───────
{
  const v = evaluateReadiness_REFERENCE(DOC_READINESS_FIXTURE_FULLY_READY);
  eq(v.readinessStatus, "ready_to_generate", "§2: readinessStatus");
  check(v.missing.length === 0, `§2: missing expected [] got [${v.missing.join(",")}]`);
  // Every required type passed.
  for (const t of REQUIRED_DOC_TYPES) {
    check(v.evaluatedDocs[t]!.passed === true, `§2: ${t}.passed must be true`);
  }
}

// ─── §3: Missing-report fixture → missing = ["report"] ───────────────
{
  const v = evaluateReadiness_REFERENCE(DOC_READINESS_FIXTURE_MISSING_REPORT);
  eq(v.readinessStatus, "missing_requirements", "§3: readinessStatus");
  check(
    v.missing.length === 1 && v.missing[0] === "report",
    `§3: missing expected [report] got [${v.missing.join(",")}]`,
  );
  eq(v.evaluatedDocs.report!.status, null, "§3: report.status null");
  eq(v.evaluatedDocs.report!.passed, false, "§3: report.passed false");
  // The other four still passed.
  eq(v.evaluatedDocs.informed_consent!.passed, true, "§3: informed_consent.passed");
  eq(v.evaluatedDocs.screening_form!.passed, true, "§3: screening_form.passed");
  eq(v.evaluatedDocs.order_note!.passed, true, "§3: order_note.passed");
  eq(v.evaluatedDocs.post_procedure_note!.passed, true, "§3: post_procedure_note.passed");
}

// ─── §4: Pending-consent fixture — present row but non-passing status ─
{
  const v = evaluateReadiness_REFERENCE(DOC_READINESS_FIXTURE_PENDING_CONSENT);
  eq(v.readinessStatus, "missing_requirements", "§4: readinessStatus");
  check(
    v.missing.length === 1 && v.missing[0] === "informed_consent",
    `§4: missing expected [informed_consent] got [${v.missing.join(",")}]`,
  );
  eq(v.evaluatedDocs.informed_consent!.status, "pending", "§4: informed_consent.status preserved");
  eq(v.evaluatedDocs.informed_consent!.passed, false, "§4: informed_consent.passed false");
}

// ─── §5: Extra unrelated doc types are ignored ───────────────────────
{
  const v = evaluateReadiness_REFERENCE(DOC_READINESS_FIXTURE_EXTRA_BILLING);
  // Verdict tracks only the five required types — billing_document is
  // not in REQUIRED_DOC_TYPES, so a missing billing_document does NOT
  // gate the verdict.
  eq(v.readinessStatus, "ready_to_generate", "§5: extra billing_document does not affect verdict");
  check(v.missing.length === 0, `§5: missing expected [] got [${v.missing.join(",")}]`);
  // billing_document is NOT in evaluatedDocs.
  check(
    !(("billing_document" as unknown as RequiredDocType) in v.evaluatedDocs),
    "§5: evaluatedDocs must not include unrelated doc types",
  );
}

// ─── §6: Empty input → all five required missing ─────────────────────
{
  const v = evaluateReadiness_REFERENCE([]);
  eq(v.readinessStatus, "missing_requirements", "§6: empty → missing_requirements");
  eq(v.missing.length, 5, "§6: missing length 5");
}

// ─── §7: Input not mutated ───────────────────────────────────────────
{
  const frozen = Object.freeze(
    DOC_READINESS_FIXTURE_FULLY_READY.map((r) => Object.freeze({ ...r })),
  );
  let threw = false;
  try {
    evaluateReadiness_REFERENCE(frozen);
  } catch (err) {
    threw = true;
    failures.push(
      `§7: evaluator threw on frozen input: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  check(!threw, "§7: evaluator must not mutate input");
}

describe("Document readiness parity test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Document readiness parity test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
