// Document / report readiness — parity fixture (Bundle 26).
//
// Data-only fixture. NOT wired to any test runner in this bundle.
// Encodes the canonical billing-readiness evaluation rule from
// server/repositories/billingReadiness.repo.ts:74-118 so a future
// wrapper PR can assert byte-parity on the verdict shape.
//
// Pinned rules (mirrors REQUIRED_DOC_RULES at line 74):
//   - informed_consent     → completed | uploaded | approved
//   - screening_form       → completed | uploaded | approved
//   - report               → uploaded  | completed | approved
//   - order_note           → generated | completed | approved
//   - post_procedure_note  → generated | completed | approved
//
// Verdict map:
//   missing.length === 0 → readinessStatus = "ready_to_generate"
//   missing.length  > 0  → readinessStatus = "missing_requirements"
//
// SCOPE / SAFETY
//   - Synthetic patient data ONLY. No real PHI.
//   - No DB. No app boot. No network.
//   - Documents/report runtime behavior unchanged by this fixture.

export const REQUIRED_DOC_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
] as const;
export type RequiredDocType = (typeof REQUIRED_DOC_TYPES)[number];

export const PASSING_STATUSES_BY_TYPE: Record<RequiredDocType, ReadonlyArray<string>> = {
  informed_consent: ["completed", "uploaded", "approved"],
  screening_form: ["completed", "uploaded", "approved"],
  report: ["uploaded", "completed", "approved"],
  order_note: ["generated", "completed", "approved"],
  post_procedure_note: ["generated", "completed", "approved"],
} as const;

/**
 * Synthetic case_document_readiness row slice.
 *
 * Mirrors the columns the evaluator reads from
 * `case_document_readiness` (shared/schema/documentReadiness.ts:69-89)
 * without importing the table at runtime.
 */
export type DocReadinessFixtureRow = {
  documentType: RequiredDocType | string;
  documentStatus: string;
};

/**
 * A canned case with EVERY required doc satisfied → verdict
 * "ready_to_generate".
 */
export const DOC_READINESS_FIXTURE_FULLY_READY: ReadonlyArray<DocReadinessFixtureRow> = [
  { documentType: "informed_consent", documentStatus: "completed" },
  { documentType: "screening_form", documentStatus: "approved" },
  { documentType: "report", documentStatus: "uploaded" },
  { documentType: "order_note", documentStatus: "generated" },
  { documentType: "post_procedure_note", documentStatus: "generated" },
];

/**
 * A canned case missing the `report` doc → verdict
 * "missing_requirements" with `missing = ["report"]`.
 */
export const DOC_READINESS_FIXTURE_MISSING_REPORT: ReadonlyArray<DocReadinessFixtureRow> = [
  { documentType: "informed_consent", documentStatus: "completed" },
  { documentType: "screening_form", documentStatus: "approved" },
  { documentType: "order_note", documentStatus: "generated" },
  { documentType: "post_procedure_note", documentStatus: "generated" },
];

/**
 * A canned case where every doc row exists but one carries a
 * non-passing status (`pending`) → verdict "missing_requirements"
 * with that doc type listed in `missing`.
 */
export const DOC_READINESS_FIXTURE_PENDING_CONSENT: ReadonlyArray<DocReadinessFixtureRow> = [
  { documentType: "informed_consent", documentStatus: "pending" },
  { documentType: "screening_form", documentStatus: "approved" },
  { documentType: "report", documentStatus: "uploaded" },
  { documentType: "order_note", documentStatus: "generated" },
  { documentType: "post_procedure_note", documentStatus: "generated" },
];

/**
 * A canned case with extra noisy rows the evaluator should ignore
 * (billing_document is required for a downstream service but is not
 * in REQUIRED_DOC_RULES today). Verdict: depends on the five
 * required types only.
 */
export const DOC_READINESS_FIXTURE_EXTRA_BILLING: ReadonlyArray<DocReadinessFixtureRow> = [
  { documentType: "informed_consent", documentStatus: "completed" },
  { documentType: "screening_form", documentStatus: "approved" },
  { documentType: "report", documentStatus: "uploaded" },
  { documentType: "order_note", documentStatus: "generated" },
  { documentType: "post_procedure_note", documentStatus: "generated" },
  { documentType: "billing_document", documentStatus: "missing" },
];

/**
 * Sanity-check the fixture itself at import time so a future edit
 * that breaks the contracts fails loud.
 */
{
  // Every required type names a non-empty passing set.
  for (const t of REQUIRED_DOC_TYPES) {
    const passing = PASSING_STATUSES_BY_TYPE[t];
    if (!Array.isArray(passing) || passing.length === 0) {
      throw new Error(`[documentReadiness fixture] missing passing statuses for ${t}`);
    }
  }
  // Fully-ready fixture must hit every required type exactly once.
  const fullyReadyTypes = new Set(DOC_READINESS_FIXTURE_FULLY_READY.map((r) => r.documentType));
  for (const t of REQUIRED_DOC_TYPES) {
    if (!fullyReadyTypes.has(t)) {
      throw new Error(`[documentReadiness fixture] fully-ready fixture missing ${t}`);
    }
  }
}
