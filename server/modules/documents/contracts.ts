// Documents — type contracts (Bundle 27).
//
// READ-ONLY MODULE SKELETON. NOT WIRED to any route in this batch.
// Mirrors the pattern set by server/modules/engagement-board and
// server/modules/operational-queue: a dormant home for the document
// shape that today is split between
//   - shared/schema/documentReadiness.ts (table + enums)
//   - server/repositories/documentReadiness.repo.ts (CRUD)
//   - server/repositories/billingReadiness.repo.ts (REQUIRED_DOC_RULES)
//
// Future PRs that surface document readiness in additional places
// (e.g. an aggregate read endpoint for the Plexus IQ modal, a
// portal-side document inbox) consume the same contracts via this
// module instead of importing the schema runtime directly. Until
// such PRs exist, the dormancy invariant in
// scripts/qa-documents-dormant-module.mjs (Bundle 27) asserts no
// non-test file imports from this module.

import type { DocumentType, DocumentStatus, DocumentTrigger } from "@shared/schema/documentReadiness";

export type { DocumentType, DocumentStatus, DocumentTrigger };

/**
 * Required document types for billing readiness (mirrors
 * REQUIRED_DOC_RULES in server/repositories/billingReadiness.repo.ts:74-80).
 *
 * Listed inline so this module is pure (no `@shared/schema` runtime
 * import; no DB pool import; no Drizzle pull-in).
 */
export const REQUIRED_DOC_TYPES_FOR_BILLING_READINESS = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
] as const;
export type RequiredDocTypeForBillingReadiness =
  (typeof REQUIRED_DOC_TYPES_FOR_BILLING_READINESS)[number];

/**
 * Per-type passing-status set used by the billing-readiness
 * evaluator (mirrors lines 75-79 of billingReadiness.repo.ts).
 */
export const PASSING_STATUSES_FOR_BILLING_READINESS: Readonly<
  Record<RequiredDocTypeForBillingReadiness, ReadonlyArray<string>>
> = {
  informed_consent: ["completed", "uploaded", "approved"],
  screening_form: ["completed", "uploaded", "approved"],
  report: ["uploaded", "completed", "approved"],
  order_note: ["generated", "completed", "approved"],
  post_procedure_note: ["generated", "completed", "approved"],
} as const;

/**
 * Minimal structural shape of a `case_document_readiness` row a
 * caller hands to the pure evaluator. Mirrors the slice of
 * `caseDocumentReadiness` (shared/schema/documentReadiness.ts:69-89)
 * the evaluator actually reads.
 *
 * Callers that already have the full row from Drizzle can pass it
 * here — TypeScript structural typing keeps the shapes
 * interchangeable.
 */
export type DocReadinessRowSlice = {
  documentType: string;
  documentStatus: string;
};

/**
 * The verdict shape returned by the pure readiness evaluator.
 */
export type DocReadinessVerdict = {
  readinessStatus: "ready_to_generate" | "missing_requirements";
  missing: RequiredDocTypeForBillingReadiness[];
  evaluatedDocs: Record<
    RequiredDocTypeForBillingReadiness,
    { status: string | null; passed: boolean }
  >;
};
