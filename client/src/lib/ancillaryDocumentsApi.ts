// Phase 2E-B — client data access for canonical Ancillary Documents.
//
// Thin wrapper over the clinic-scoped read endpoints. Never fetches when the
// unified flag is OFF (callers guard), and never carries document bytes.

import type {
  AncillaryDocumentContractItem,
  AncillaryDocumentsListResponse,
} from "@shared/schema/ancillaryDocuments";

export type { AncillaryDocumentContractItem, AncillaryDocumentsListResponse };

export type AncillaryDocumentsListParams = {
  patientScreeningId?: number;
  executionCaseId?: number;
  globalPlexusPatientId?: number;
  ancillaryCaseId?: number;
  serviceType?: string;
  documentKind?: string;
  documentStatus?: string;
  includeHistory?: boolean;
  limit?: number;
  // Opaque compound keyset cursor (string), returned as nextCursor.
  cursor?: string;
};

/** Build the query string for GET /api/ancillary-documents (stable keys). */
export function buildAncillaryDocumentsQuery(params: AncillaryDocumentsListParams): string {
  const q = new URLSearchParams();
  if (params.patientScreeningId != null) q.set("patientScreeningId", String(params.patientScreeningId));
  if (params.executionCaseId != null) q.set("executionCaseId", String(params.executionCaseId));
  if (params.globalPlexusPatientId != null) q.set("globalPlexusPatientId", String(params.globalPlexusPatientId));
  if (params.ancillaryCaseId != null) q.set("ancillaryCaseId", String(params.ancillaryCaseId));
  if (params.serviceType) q.set("serviceType", params.serviceType);
  if (params.documentKind) q.set("documentKind", params.documentKind);
  if (params.documentStatus) q.set("documentStatus", params.documentStatus);
  if (params.includeHistory === false) q.set("includeHistory", "false");
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.cursor != null) q.set("cursor", String(params.cursor));
  const s = q.toString();
  return s ? `/api/ancillary-documents?${s}` : "/api/ancillary-documents";
}

export async function fetchAncillaryDocuments(
  params: AncillaryDocumentsListParams = {},
): Promise<AncillaryDocumentsListResponse> {
  const res = await fetch(buildAncillaryDocumentsQuery(params), { credentials: "include" });
  if (res.status === 503) {
    // Controlled migration-missing signal — render an empty, non-fatal list.
    return { items: [], nextCursor: null };
  }
  if (!res.ok) throw new Error(`ancillary-documents ${res.status}`);
  return (await res.json()) as AncillaryDocumentsListResponse;
}

// ─── Presentation helpers (pure) ────────────────────────────────────
export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  order_note: "Order Note",
  report: "Report",
  consent: "Consent",
  screening_form: "Screening Form",
};

export function documentKindLabel(kind: string): string {
  return DOCUMENT_KIND_LABEL[kind] ?? kind;
}

/** Coarse status bucket for badges. Signed notes are read-only. */
export function documentStatusBucket(item: AncillaryDocumentContractItem):
  "signed" | "pending_signature" | "uploaded" | "history" | "pending" {
  if (!item.isCurrent) return "history";
  if (item.documentStatus === "signed") return "signed";
  if (item.documentStatus === "pending_signature") return "pending_signature";
  if (item.documentStatus === "uploaded") return "uploaded";
  return "pending";
}
