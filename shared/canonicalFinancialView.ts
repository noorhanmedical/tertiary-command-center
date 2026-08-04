// Phase 2J — shared canonical financial DTOs (server + client). READ-ONLY,
// clinic-scoped, evidence-versioned. Money is a fixed-precision 2-decimal STRING
// with an explicit `currency`. NO document bodies, note text, payment credentials,
// card/bank data, sensitive payer identifiers, or revenue-share/profit fields. The
// client renders these directly and NEVER recomputes canonical financial status.

export const CANONICAL_FINANCIAL_VIEW_VERSION = "canonical_financial_view_v1";
export const FINANCIAL_DEFAULT_LIMIT = 25;
export const FINANCIAL_MAX_LIMIT = 100;

export type FinancialAvailability =
  | "available" | "disabled_flag_off" | "upstream_flag_off" | "migration_missing" | "unavailable";

export type CodeCount = { code: string; count: number };
export type PageInfo = { limit: number; nextCursor: string | null; returned: number };

// ─── Claim ───────────────────────────────────────────────────────────────────
export type CanonicalClaimRow = {
  claimId: number;
  ancillaryCaseId: number;
  serviceType: string;
  patientDisplay: string | null;        // authorized display only (verified membership)
  status: string;                        // canonical claim status
  claimReady: boolean;
  attemptNumber: number;
  supersedesClaimId: number | null;
  billingDocumentId: number | null;
  billingReadinessCheckId: number | null;
  evidenceFingerprint: string | null;
  currency: string;
  chargeAmount: string | null;           // fixed-precision string, or null when unavailable
  submissionBlockers: CodeCount[];
  warnings: string[];
  submittedAt: string | null;
  submissionSource: string | null;       // clearinghouse_response | imported_acknowledgment | manual_attestation
  integrity: "resolved" | "missing" | "conflicting";
  evaluatedAt: string | null;
};

// ─── Invoice ─────────────────────────────────────────────────────────────────
export type CanonicalInvoiceRow = {
  invoiceId: number;
  ancillaryCaseId: number;
  serviceType: string;
  patientDisplay: string | null;
  invoiceType: string;                   // patient | payer | clinic (never merged)
  recipientType: string | null;
  status: string;
  invoiceNumber: string | null;
  claimId: number | null;
  currency: string;
  totalAmount: string | null;
  // Distinct money facets (never conflated).
  balance: CanonicalBalance;
  issuedAt: string | null;
  deliveredAt: string | null;
  warnings: string[];
  integrity: "resolved" | "missing" | "conflicting";
};

// ─── Payment (ledger event) ──────────────────────────────────────────────────
export type CanonicalPaymentRow = {
  paymentId: number;
  ancillaryCaseId: number | null;
  claimId: number | null;
  invoiceId: number | null;
  eventType: string;                     // payment | refund | reversal | adjustment
  paymentType: string;                   // patient | payer | manual | processor_import | remittance_import
  status: string;                        // posted | reversed | failed
  currency: string;
  amount: string;
  externalTransactionId: string | null;  // opaque reference only — never card/bank data
  reversesPaymentId: number | null;
  postedAt: string | null;
  warnings: string[];
};

// ─── Balance (DERIVED from the append-only ledger, never a stored truth) ──────
export type CanonicalBalance = {
  currency: string;
  originalAmount: string;
  approvedAdjustments: string;
  paidAmount: string;
  refundedAmount: string;
  reversedAmount: string;
  unappliedAmount: string;
  outstandingBalance: string;
  overpayment: string;
  integrity: "resolved" | "conflicting";
  warnings: string[];
};

// ─── Combined bounded view envelope ──────────────────────────────────────────
export type FinancialSection<Row> = {
  availability: FinancialAvailability;
  warnings: string[];
  rows: Row[];
  pageInfo: PageInfo;
};
export type CanonicalFinancialView = {
  disabled: boolean;
  generatedAt: string;
  dataVersion: string;
  clinicScoped: true;
  claims: FinancialSection<CanonicalClaimRow>;
  invoices: FinancialSection<CanonicalInvoiceRow>;
  payments: FinancialSection<CanonicalPaymentRow>;
};

export function disabledFinancialSection<Row>(availability: FinancialAvailability = "disabled_flag_off"): FinancialSection<Row> {
  return { availability, warnings: [], rows: [], pageInfo: { limit: FINANCIAL_DEFAULT_LIMIT, nextCursor: null, returned: 0 } };
}
export function disabledCanonicalFinancialView(generatedAt: string): CanonicalFinancialView {
  return {
    disabled: true, generatedAt, dataVersion: CANONICAL_FINANCIAL_VIEW_VERSION, clinicScoped: true,
    claims: disabledFinancialSection(), invoices: disabledFinancialSection(), payments: disabledFinancialSection(),
  };
}
