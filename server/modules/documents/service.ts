// Documents — dormant pure-helpers service (Bundle 27).
//
// READ-ONLY. DORMANT. Not wired to any route in this batch.
// Future PRs (e.g. the Plexus IQ aggregate read endpoint contracted
// in Bundle 25, or a portal-side document inbox) may adopt these
// helpers; until then the dormancy invariant in
// scripts/qa-documents-dormant-module.mjs (Bundle 27) asserts no
// non-test file imports from this module.
//
// SAFETY INVARIANTS
//   - No DB import. No schema runtime import. No drizzle import.
//   - No writes. Pure transformations.
//   - Byte-equivalent to the legacy evaluator at
//     server/repositories/billingReadiness.repo.ts:113-121.

import {
  PASSING_STATUSES_FOR_BILLING_READINESS,
  REQUIRED_DOC_TYPES_FOR_BILLING_READINESS,
  type DocReadinessRowSlice,
  type DocReadinessVerdict,
  type RequiredDocTypeForBillingReadiness,
} from "./contracts";

/**
 * Returns the canonical passing-status set for a required doc type.
 * Returns an empty array for non-required types.
 */
export function getPassingStatusesForDocType(
  docType: string,
): ReadonlyArray<string> {
  if (
    (REQUIRED_DOC_TYPES_FOR_BILLING_READINESS as ReadonlyArray<string>).includes(
      docType,
    )
  ) {
    return PASSING_STATUSES_FOR_BILLING_READINESS[
      docType as RequiredDocTypeForBillingReadiness
    ];
  }
  return [];
}

/**
 * Returns true if `documentStatus` is a passing status for the
 * required doc type, false otherwise (including for non-required
 * doc types).
 */
export function isPassingStatusForDocType(
  docType: string,
  documentStatus: string | null | undefined,
): boolean {
  if (documentStatus == null) return false;
  const passing = getPassingStatusesForDocType(docType);
  return passing.includes(documentStatus);
}

/**
 * Pure billing-readiness evaluator. Takes a list of doc-readiness
 * row slices and returns the verdict shape.
 *
 * Mirrors server/repositories/billingReadiness.repo.ts:113-121.
 */
export function evaluateBillingReadinessFromRows(
  rows: ReadonlyArray<DocReadinessRowSlice>,
): DocReadinessVerdict {
  const docStatusByType = new Map<string, string>();
  for (const r of rows) docStatusByType.set(r.documentType, r.documentStatus);

  const missing: RequiredDocTypeForBillingReadiness[] = [];
  const evaluatedDocs = {} as DocReadinessVerdict["evaluatedDocs"];
  for (const t of REQUIRED_DOC_TYPES_FOR_BILLING_READINESS) {
    const status = docStatusByType.get(t) ?? null;
    const passed = isPassingStatusForDocType(t, status);
    if (!passed) missing.push(t);
    evaluatedDocs[t] = { status, passed };
  }
  return {
    readinessStatus: missing.length === 0 ? "ready_to_generate" : "missing_requirements",
    missing,
    evaluatedDocs,
  };
}
