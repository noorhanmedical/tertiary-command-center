// Invoicing scaffold V2 (Phase 1 Segment G Batch 4).
//
// DORMANT module. Pure projection from a billing-ready snapshot +
// pricing input to a draft invoice + line-items shape. NO db writes;
// a future approved batch wires the storage helper. NO claims, ERA,
// remittance, denial, or payment-posting logic — those are out of
// Phase 1.
//
// Contract: docs/architecture/phase-1-invoicing-boundary-contract.md

import type {
  BillingReadinessSnapshot,
} from "../billingReadiness/billingReadinessAggregator";

export type InvoiceLineItemDraft = {
  serviceCode: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
};

export type InvoiceDraft = {
  patientScreeningId: number;
  status: "draft";
  currency: "USD";
  lineItems: InvoiceLineItemDraft[];
  totalCents: number;
  createdAt: string;
};

export type CashPricingInput = {
  serviceCode: string;
  description: string;
  unitAmountCents: number;
  quantity?: number;
};

export type CreateDraftInvoiceInputs = {
  readinessSnapshot: BillingReadinessSnapshot;
  pricing: CashPricingInput[];
  now: () => Date;
};

export function isInvoicingScaffoldEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.USE_INVOICING_SCAFFOLD_V2;
  return v === "1" || v === "true" || v === "yes";
}

export class InvoicingScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicingScaffoldError";
  }
}

export function createDraftInvoice(inputs: CreateDraftInvoiceInputs): InvoiceDraft {
  if (inputs.readinessSnapshot.readinessStatus !== "ready") {
    throw new InvoicingScaffoldError(
      `cannot draft invoice — readinessStatus is "${inputs.readinessSnapshot.readinessStatus}"`,
    );
  }
  if (inputs.pricing.length === 0) {
    throw new InvoicingScaffoldError("pricing input is empty");
  }
  const lineItems: InvoiceLineItemDraft[] = inputs.pricing.map((p) => ({
    serviceCode: p.serviceCode,
    description: p.description,
    quantity: p.quantity ?? 1,
    unitAmountCents: p.unitAmountCents,
  }));
  const totalCents = lineItems.reduce((sum, li) => sum + li.unitAmountCents * li.quantity, 0);
  return {
    patientScreeningId: inputs.readinessSnapshot.patientScreeningId,
    status: "draft",
    currency: "USD",
    lineItems,
    totalCents,
    createdAt: inputs.now().toISOString(),
  };
}
