import assert from "node:assert/strict";
import {
  computeBillingReadiness,
  isBillingReadinessAggregatorEnabled,
  type BillingReadinessInputs,
} from "../billingReadinessAggregator";

const FIXED = new Date("2026-06-11T12:00:00Z");
const now = () => FIXED;

function inputs(overrides: Partial<BillingReadinessInputs> = {}): BillingReadinessInputs {
  return {
    patientScreeningId: 1,
    procedureComplete: true,
    eligibilityKnown: true,
    documents: [
      { kind: "report", present: true, signingStatus: "signed" },
      { kind: "order_note", present: true },
      { kind: "post_procedure_note", present: true, signingStatus: "signed" },
      { kind: "billing_document", present: true },
    ],
    alreadyBilled: false,
    now,
    ...overrides,
  };
}

async function main() {
  // Flag default-OFF.
  assert.equal(isBillingReadinessAggregatorEnabled({}), false);
  assert.equal(isBillingReadinessAggregatorEnabled({ USE_BILLING_READINESS_AGGREGATOR_V2: "1" }), true);
  assert.equal(isBillingReadinessAggregatorEnabled({ USE_BILLING_READINESS_AGGREGATOR_V2: "true" }), true);
  assert.equal(isBillingReadinessAggregatorEnabled({ USE_BILLING_READINESS_AGGREGATOR_V2: "yes" }), true);

  // Happy path -> ready.
  {
    const snap = computeBillingReadiness(inputs());
    assert.equal(snap.readinessStatus, "ready");
    assert.equal(snap.blockers.length, 0);
    assert.equal(snap.lastEvaluatedAt, FIXED.toISOString());
  }

  // Procedure incomplete -> incomplete.
  {
    const snap = computeBillingReadiness(inputs({ procedureComplete: false }));
    assert.equal(snap.readinessStatus, "incomplete");
    assert.ok(snap.blockers.some((b) => b.kind === "procedure_not_complete"));
  }

  // Eligibility unknown also yields incomplete.
  {
    const snap = computeBillingReadiness(inputs({ eligibilityKnown: false }));
    assert.equal(snap.readinessStatus, "incomplete");
    assert.ok(snap.blockers.some((b) => b.kind === "eligibility_unknown"));
  }

  // Missing report doc -> blocked (procedure OK, eligibility OK).
  {
    const snap = computeBillingReadiness(inputs({
      documents: [
        { kind: "order_note", present: true },
        { kind: "post_procedure_note", present: true, signingStatus: "signed" },
        { kind: "billing_document", present: true },
      ],
    }));
    assert.equal(snap.readinessStatus, "blocked");
    assert.ok(snap.blockers.some((b) => b.kind === "missing_document" && b.documentKind === "report"));
  }

  // Unsigned signing-required doc -> blocked.
  {
    const snap = computeBillingReadiness(inputs({
      documents: [
        { kind: "report", present: true, signingStatus: "pending" },
        { kind: "order_note", present: true },
        { kind: "post_procedure_note", present: true, signingStatus: "signed" },
        { kind: "billing_document", present: true },
      ],
    }));
    assert.equal(snap.readinessStatus, "blocked");
    assert.ok(snap.blockers.some((b) => b.kind === "unsigned_document" && b.documentKind === "report"));
  }

  // alreadyBilled short-circuits.
  {
    const snap = computeBillingReadiness(inputs({ alreadyBilled: true, procedureComplete: false }));
    assert.equal(snap.readinessStatus, "billed");
    assert.equal(snap.blockers.length, 0);
  }

  console.log("Billing readiness aggregator test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
