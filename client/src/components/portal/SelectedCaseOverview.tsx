// Phase 2E-B2 — selected-case detail wrapper for CaseOverview.
//
// The ACS/PCS portal shows exactly ONE selected case at a time. This wrapper
// is the single-selected-case detail panel: it performs ONE canonical
// documents query for that case and passes the result into the (now
// presentation-only) CaseOverview as data. CaseOverview itself never fetches,
// so mounting case cards never causes a per-card canonical request (no N+1).
// Feature OFF → the query is disabled → zero canonical reads.

import { CaseOverview, type CaseOverviewProps } from "@/components/portal/CaseOverview";
import { useAncillaryDocuments } from "@/components/ancillary-documents/CanonicalAncillaryDocuments";
import { isUnifiedAncillaryDocumentsEnabled } from "@/lib/unifiedAncillaryDocumentsFlag";

export function SelectedCaseOverview(props: Omit<CaseOverviewProps, "ancillaryDocuments">) {
  const screeningId = props.ctx.patientScreeningId;
  const enabled = isUnifiedAncillaryDocumentsEnabled() && typeof screeningId === "number" && screeningId > 0;
  // ONE current-only query for the single selected case.
  const { data } = useAncillaryDocuments(
    { patientScreeningId: screeningId ?? undefined, includeHistory: false },
    enabled,
  );
  return <CaseOverview {...props} ancillaryDocuments={data?.items ?? []} />;
}
