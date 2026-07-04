import { it } from "vitest";
import assert from "node:assert/strict";
import {
  InvoicingScaffoldError,
  createDraftInvoice,
  isInvoicingScaffoldEnabled,
  type CreateDraftInvoiceInputs,
} from "../invoicingScaffold";
import type { BillingReadinessSnapshot } from "../../billingReadiness/billingReadinessAggregator";

const FIXED = new Date("2026-06-11T12:00:00Z");
const now = () => FIXED;

function readinessReady(): BillingReadinessSnapshot {
  return {
    patientScreeningId: 7,
    readinessStatus: "ready",
    blockers: [],
    lastEvaluatedAt: FIXED.toISOString(),
  };
}

function inputs(overrides: Partial<CreateDraftInvoiceInputs> = {}): CreateDraftInvoiceInputs {
  return {
    readinessSnapshot: readinessReady(),
    pricing: [
      { serviceCode: "PROC-A", description: "Ancillary procedure A", unitAmountCents: 12500 },
      { serviceCode: "FAC-A", description: "Facility fee", unitAmountCents: 4500, quantity: 1 },
    ],
    now,
    ...overrides,
  };
}

async function main() {
  // Flag default-OFF.
  assert.equal(isInvoicingScaffoldEnabled({}), false);
  assert.equal(isInvoicingScaffoldEnabled({ USE_INVOICING_SCAFFOLD_V2: "1" }), true);
  assert.equal(isInvoicingScaffoldEnabled({ USE_INVOICING_SCAFFOLD_V2: "true" }), true);
  assert.equal(isInvoicingScaffoldEnabled({ USE_INVOICING_SCAFFOLD_V2: "yes" }), true);

  // Happy path -> draft invoice.
  {
    const inv = createDraftInvoice(inputs());
    assert.equal(inv.status, "draft");
    assert.equal(inv.currency, "USD");
    assert.equal(inv.patientScreeningId, 7);
    assert.equal(inv.lineItems.length, 2);
    assert.equal(inv.totalCents, 12500 + 4500);
    assert.equal(inv.createdAt, FIXED.toISOString());
  }

  // Quantity defaults to 1; multi-quantity sums correctly.
  {
    const inv = createDraftInvoice(inputs({
      pricing: [
        { serviceCode: "SVC", description: "x3", unitAmountCents: 1000, quantity: 3 },
      ],
    }));
    assert.equal(inv.totalCents, 3000);
    assert.equal(inv.lineItems[0].quantity, 3);
  }

  // Non-ready snapshot rejects.
  {
    let threw = false;
    try {
      createDraftInvoice(inputs({
        readinessSnapshot: { ...readinessReady(), readinessStatus: "blocked" },
      }));
    } catch (e) {
      threw = true;
      assert.ok(e instanceof InvoicingScaffoldError);
      assert.ok(String((e as Error).message).includes("blocked"));
    }
    assert.equal(threw, true);
  }

  // Empty pricing rejects.
  {
    let threw = false;
    try { createDraftInvoice(inputs({ pricing: [] })); } catch { threw = true; }
    assert.equal(threw, true);
  }

  console.log("Invoicing scaffold test passed.");
}

it("Invoicing scaffold", async () => {
  await main();
});
