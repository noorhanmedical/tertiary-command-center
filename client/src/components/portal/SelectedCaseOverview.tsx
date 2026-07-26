// Phase 2E-B3 — selected-case detail wrapper for CaseOverview.
//
// The ACS/PCS portal shows exactly ONE selected case at a time. This wrapper
// is the single-selected-case detail panel: it performs ONE canonical
// documents query scoped to the EXACT ancillaryCaseId (never the whole
// screening), so a BrainWave case never shows an Ultrasound case's documents
// and two episodes of the same service stay separate. CaseOverview itself
// never fetches, so mounting case cards causes zero per-card requests.
//
// When the context carries NO ancillaryCaseId (unknown/ambiguous), we render
// NO canonical summary and issue NO request — never a screening-wide fallback.
// Feature OFF → the query is disabled → zero canonical reads.

import { CaseOverview, type CaseOverviewProps } from "@/components/portal/CaseOverview";
import { useAncillaryDocuments } from "@/components/ancillary-documents/CanonicalAncillaryDocuments";
import { isUnifiedAncillaryDocumentsEnabled } from "@/lib/unifiedAncillaryDocumentsFlag";
import type { CallCaseContext } from "@/components/portal/caseWorkspace";
import type { AncillaryDocumentsListParams } from "@/lib/ancillaryDocumentsApi";

/**
 * Pure: derive the EXACT-case document query from a case context. `hasExactCase`
 * is true only when the context carries an unambiguous ancillaryCaseId; the
 * params are scoped to that exact case (never patientScreeningId — no
 * screening-wide request). Exported for direct testing.
 */
export function selectedCaseDocParams(
  ctx: Pick<CallCaseContext, "ancillaryCaseId" | "serviceType">,
): { hasExactCase: boolean; params: AncillaryDocumentsListParams } {
  const hasExactCase = typeof ctx.ancillaryCaseId === "number" && ctx.ancillaryCaseId > 0;
  return {
    hasExactCase,
    params: {
      ancillaryCaseId: hasExactCase ? (ctx.ancillaryCaseId as number) : undefined,
      serviceType: ctx.serviceType ?? undefined,
      includeHistory: false,
    },
  };
}

export function SelectedCaseOverview(props: Omit<CaseOverviewProps, "ancillaryDocuments">) {
  const { hasExactCase, params } = selectedCaseDocParams(props.ctx);
  const enabled = isUnifiedAncillaryDocumentsEnabled() && hasExactCase;
  // ONE current-only query scoped to the EXACT ancillary case (server is the
  // authority — it filters by ancillaryCaseId + clinic).
  const { data } = useAncillaryDocuments(params, enabled);
  return <CaseOverview {...props} ancillaryDocuments={enabled ? (data?.items ?? []) : []} />;
}
