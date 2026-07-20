// Physician Portal — summary + financial-health service.
//
// Delegates scoped-repo reads to physicianPortalOps.repo. Owns the
// response shape the client contract expects.
//
// Contract discipline:
//   - No fabricated metrics. When a section cannot be audited safely from
//     canonical tables it is returned as { unavailable: true } (with an
//     empty numeric fallback) so the UI can render an honest empty state.
//   - No broad getAll aggregation.
//   - No raw db.select / db.execute in the route layer above.

import {
  countProcedureNotesNeedingSignature,
  countReportsPending,
  sumOpenAR,
  buildFinancialHealthOverall,
  type PhysicianPortalSummary,
  type PhysicianSummaryFilters,
  type FinancialHealthOverall,
} from "../../repositories/physicianPortalOps.repo";

export type PhysicianPortalSummaryResponse = PhysicianPortalSummary;

export async function getPhysicianPortalSummary(
  filters: PhysicianSummaryFilters = {},
): Promise<PhysicianPortalSummaryResponse> {
  const [needsSignature, reportsPending, pendingAR] = await Promise.all([
    countProcedureNotesNeedingSignature(),
    countReportsPending(),
    sumOpenAR(filters),
  ]);
  return { needsSignature, reportsPending, pendingAR };
}

// The Plexus Ancillary Contribution breakdown lives behind an
// unavailable-safe flag until its scoped repo helper lands with tests.
// Fabricating a "gross estimate" from cash_price_settings × completed
// package rows is what the persistence route did; it is intentionally
// NOT copied verbatim because it inferred values that were never audited
// against the invoice → remittance ledger.
export type PlexusContributionUnavailable = {
  unavailable: true;
  reason: string;
};

export type FinancialHealthResponse = {
  overall: FinancialHealthOverall;
  plexusContribution: PlexusContributionUnavailable;
};

export async function getFinancialHealth(
  filters: PhysicianSummaryFilters = {},
): Promise<FinancialHealthResponse> {
  const overall = await buildFinancialHealthOverall(filters);
  return {
    overall,
    plexusContribution: {
      unavailable: true,
      reason:
        "Plexus service contribution aggregation is deferred until a scoped, audited pricing + package-status repository helper lands.",
    },
  };
}
