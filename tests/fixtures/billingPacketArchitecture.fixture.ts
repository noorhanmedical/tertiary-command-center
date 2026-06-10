// Billing packet architecture — PHI-safe parity fixture (Bundle 28).
//
// Data-only fixture. NOT wired to any runtime path in this bundle.
// Pins the architecture surface of `billing_readiness_checks`
// (shared/schema/billingReadiness.ts) so a future PR cannot silently:
//   - add a status to BILLING_READINESS_STATUSES,
//   - change the directional transition graph,
//   - reshape the `missingRequirements` array,
//   - reshape the `metadata.evaluatedDocs` slice the readiness
//     evaluator (server/repositories/billingReadiness.repo.ts:113-121)
//     writes when it upserts a check.
//
// EXPLICITLY OUT OF SCOPE (per the safe-bundle rules):
//   - NO money math. No claim/remittance/invoice/payment fields.
//   - NO `completed_billing_packages` columns (those carry
//     fullAmountPaid / paymentStatus / paymentDate — money territory).
//   - NO runtime billing behavior touched.
//   - NO PHI. Patient identifiers are synthetic only.

/**
 * Canonical readiness statuses. Mirrors
 * shared/schema/billingReadiness.ts:10-14.
 */
export const BILLING_READINESS_STATUSES_FIXTURE = [
  "not_ready",
  "missing_requirements",
  "ready_to_generate",
  "billing_document_generated",
  "sent_to_billing",
] as const;
export type BillingReadinessStatusFixture =
  (typeof BILLING_READINESS_STATUSES_FIXTURE)[number];

/**
 * Allowed forward transitions between readiness statuses. The
 * legacy evaluator writes statuses idempotently (the same status
 * may be re-written), so self-loops are allowed implicitly. This
 * map enumerates the strict forward edges only.
 *
 * Drift from this map would change the semantic meaning of the
 * billing-packet lifecycle and MUST surface in a future PR.
 */
export const BILLING_READINESS_TRANSITIONS_FIXTURE: Readonly<
  Record<BillingReadinessStatusFixture, ReadonlyArray<BillingReadinessStatusFixture>>
> = {
  not_ready: ["missing_requirements", "ready_to_generate"],
  missing_requirements: ["ready_to_generate", "missing_requirements"],
  ready_to_generate: ["billing_document_generated", "missing_requirements"],
  billing_document_generated: ["sent_to_billing"],
  sent_to_billing: [],
} as const;

/**
 * Minimal architecture slice of `billing_readiness_checks` a future
 * read-side consumer needs. Excludes every money-bearing field by
 * construction; if a future PR adds a money field to this row, the
 * fixture is the wrong place to capture it — open a separate
 * bundle.
 *
 * Mirrors a SUBSET of shared/schema/billingReadiness.ts:18-32 — the
 * columns related to readiness state, plus the patient/service
 * identifiers needed to route the row.
 */
export type BillingReadinessArchitectureSlice = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  // Identity fields the schema carries — preserved here as nullable
  // strings (synthetic-only). NOT used for money math.
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
  readinessStatus: BillingReadinessStatusFixture;
  missingRequirements: string[];
  // `metadata.evaluatedDocs` slice the readiness evaluator writes.
  // Keys are required doc types; values are { status, passed }.
  evaluatedDocs: Record<string, { status: string | null; passed: boolean }>;
};

/**
 * Three canned slices spanning the architecture surface.
 *   Row 1 — fully ready, missing = [].
 *   Row 2 — missing requirements, missing = ["report"].
 *   Row 3 — billing-document generated, missing = [].
 */
export const BILLING_READINESS_FIXTURE_ROWS: ReadonlyArray<BillingReadinessArchitectureSlice> = [
  {
    id: 9001,
    executionCaseId: 501,
    patientScreeningId: 1001,
    procedureEventId: 701,
    patientName: "Test Patient A1",
    patientDob: "1980-01-15",
    facilityId: "Bay Pavilion",
    serviceType: "us_pelvic",
    readinessStatus: "ready_to_generate",
    missingRequirements: [],
    evaluatedDocs: {
      informed_consent: { status: "completed", passed: true },
      screening_form: { status: "approved", passed: true },
      report: { status: "uploaded", passed: true },
      order_note: { status: "generated", passed: true },
      post_procedure_note: { status: "generated", passed: true },
    },
  },
  {
    id: 9002,
    executionCaseId: 502,
    patientScreeningId: 1002,
    procedureEventId: 702,
    patientName: "Test Patient A2",
    patientDob: "1981-02-16",
    facilityId: "Harbor Medical",
    serviceType: "us_abdominal",
    readinessStatus: "missing_requirements",
    missingRequirements: ["report"],
    evaluatedDocs: {
      informed_consent: { status: "completed", passed: true },
      screening_form: { status: "approved", passed: true },
      report: { status: null, passed: false },
      order_note: { status: "generated", passed: true },
      post_procedure_note: { status: "generated", passed: true },
    },
  },
  {
    id: 9003,
    executionCaseId: 503,
    patientScreeningId: 1003,
    procedureEventId: 703,
    patientName: "Test Patient A3",
    patientDob: "1982-03-17",
    facilityId: "Sandy Bay Center",
    serviceType: "us_pelvic",
    readinessStatus: "billing_document_generated",
    missingRequirements: [],
    evaluatedDocs: {
      informed_consent: { status: "completed", passed: true },
      screening_form: { status: "approved", passed: true },
      report: { status: "uploaded", passed: true },
      order_note: { status: "generated", passed: true },
      post_procedure_note: { status: "generated", passed: true },
    },
  },
];

/**
 * Sanity-check the fixture at import time so a future edit that
 * breaks the contract fails loud.
 */
{
  // Every status in BILLING_READINESS_STATUSES_FIXTURE has an entry
  // in the transition map.
  for (const s of BILLING_READINESS_STATUSES_FIXTURE) {
    if (!(s in BILLING_READINESS_TRANSITIONS_FIXTURE)) {
      throw new Error(`[billing fixture] transition map missing entry for ${s}`);
    }
  }
  // Every target in the transition map is itself a valid status.
  for (const [src, targets] of Object.entries(BILLING_READINESS_TRANSITIONS_FIXTURE)) {
    for (const t of targets) {
      if (!(BILLING_READINESS_STATUSES_FIXTURE as ReadonlyArray<string>).includes(t)) {
        throw new Error(
          `[billing fixture] transition ${src} -> ${t} targets an unknown status`,
        );
      }
    }
  }
  // No row carries a money-shaped field name.
  const moneyKeys = [
    "fullAmountPaid",
    "paymentStatus",
    "paymentDate",
    "amount",
    "amountDue",
    "amountPaid",
    "balanceDue",
    "claimAmount",
    "remittanceAmount",
  ];
  for (const row of BILLING_READINESS_FIXTURE_ROWS) {
    for (const k of moneyKeys) {
      if (k in (row as unknown as Record<string, unknown>)) {
        throw new Error(`[billing fixture] row #${row.id} carries forbidden money field "${k}"`);
      }
    }
  }
}
