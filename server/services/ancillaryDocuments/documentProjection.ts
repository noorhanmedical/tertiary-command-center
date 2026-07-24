/**
 * Phase 2E — unified Ancillary Documents read projection.
 *
 * The one server reader every surface (Patient EHR + the global
 * /ancillary-documents operational view) uses. It reads canonical
 * references (never file bytes / note text), groups them per ancillary
 * case + service, and marks readiness/warnings.
 *
 * Feature contract:
 *   • FEATURE_UNIFIED_ANCILLARY_DOCUMENTS OFF → empty projection, ZERO
 *     reads.
 *   • ON → reads references; a missing migration surfaces the repo's
 *     controlled ANCILLARY_DOCUMENT_MIGRATION_MISSING (fails closed —
 *     never an unrestricted legacy fallback).
 *   • doctor_visit never produces an Ancillary Document.
 *   • Another clinic's references are never returned.
 */

import { featureFlags } from "../../lib/featureFlags";
import {
  searchClinicReferences,
  type ClinicDocumentSearchFilters,
} from "../../repositories/ancillaryDocuments.repo";
import type {
  AncillaryDocumentReference,
  AncillaryDocumentContractItem,
} from "@shared/schema/ancillaryDocuments";

// The per-case view reuses the shared contract item shape verbatim so every
// surface renders identical fields + ids.
export type AncillaryDocumentView = AncillaryDocumentContractItem;

export type AncillaryCaseDocuments = {
  ancillaryCaseId: number;
  serviceType: string | null;
  documents: AncillaryDocumentView[];
  warnings: string[];
};

export type AncillaryDocumentsProjection = {
  flagOff: boolean;
  cases: AncillaryCaseDocuments[];
};

export type DocumentsProjectionQuery = {
  clinicId: number;
  ancillaryCaseId?: number;
  patientScreeningId?: number;
  executionCaseId?: number;
  globalPlexusPatientId?: number;
  includeHistory?: boolean;
};

// Optional documents whose absence is a WARNING, never a blocker.
const OPTIONAL_KINDS = ["report", "screening_form"] as const;

function readinessFor(ref: AncillaryDocumentReference): "ready" | "pending" | "history" {
  if (ref.supersededAt != null || ref.documentStatus === "superseded" || ref.documentStatus === "voided") return "history";
  if (ref.documentStatus === "signed" || ref.documentStatus === "uploaded") return "ready";
  return "pending";
}

function isCurrentRef(ref: AncillaryDocumentReference): boolean {
  return ref.supersededAt == null && ref.documentStatus !== "voided" && ref.documentStatus !== "superseded";
}

function toView(ref: AncillaryDocumentReference): AncillaryDocumentView {
  return {
    ancillaryDocumentReferenceId: ref.id,
    ancillaryCaseId: ref.ancillaryCaseId,
    serviceType: ref.serviceType,
    documentKind: ref.documentKind,
    sourceSystem: ref.sourceSystem,
    sourceTable: ref.sourceTable,
    sourceId: ref.sourceId,
    documentStatus: ref.documentStatus,
    effectiveClinicalDate: ref.effectiveClinicalDate ? ref.effectiveClinicalDate.toISOString() : null,
    actualCreatedAt: ref.actualCreatedAt.toISOString(),
    signedAt: ref.signedAt ? ref.signedAt.toISOString() : null,
    supersededAt: ref.supersededAt ? ref.supersededAt.toISOString() : null,
    isCurrent: isCurrentRef(ref),
    // A stable source pointer — never document bytes, never a raw bucket key.
    downloadReference: `${ref.sourceTable}:${ref.sourceId}`,
    readiness: readinessFor(ref),
    warnings: [],
  };
}

export async function getAncillaryDocumentsProjection(
  query: DocumentsProjectionQuery,
): Promise<AncillaryDocumentsProjection> {
  if (!featureFlags.unifiedAncillaryDocuments) return { flagOff: true, cases: [] };

  const filters: ClinicDocumentSearchFilters = { clinicId: query.clinicId };
  if (query.ancillaryCaseId != null) filters.ancillaryCaseId = query.ancillaryCaseId;
  if (query.patientScreeningId != null) filters.patientScreeningId = query.patientScreeningId;
  if (query.executionCaseId != null) filters.executionCaseId = query.executionCaseId;
  if (query.globalPlexusPatientId != null) filters.globalPlexusPatientId = query.globalPlexusPatientId;

  const refs = await searchClinicReferences(filters);
  // Tenant guard (defence in depth) — never surface another clinic's row.
  const scoped = refs.filter((r) => r.clinicId === query.clinicId);

  const byCase = new Map<number, AncillaryDocumentReference[]>();
  for (const r of scoped) {
    const arr = byCase.get(r.ancillaryCaseId) ?? [];
    arr.push(r);
    byCase.set(r.ancillaryCaseId, arr);
  }

  const cases: AncillaryCaseDocuments[] = [];
  for (const [ancillaryCaseId, caseRefs] of byCase) {
    const includeHistory = query.includeHistory ?? true;
    const active = caseRefs.filter((r) => r.supersededAt == null && r.documentStatus !== "voided");
    const shown = includeHistory ? caseRefs : active;
    const serviceType = caseRefs.find((r) => r.serviceType != null)?.serviceType ?? null;

    const presentKinds = new Set(active.map((r) => r.documentKind));
    const warnings: string[] = [];
    for (const k of OPTIONAL_KINDS) {
      if (!presentKinds.has(k)) warnings.push(`${k}_missing`);
    }

    cases.push({
      ancillaryCaseId,
      serviceType,
      documents: shown
        .sort((a, b) => a.actualCreatedAt.getTime() - b.actualCreatedAt.getTime() || a.id - b.id)
        .map(toView),
      warnings,
    });
  }
  return { flagOff: false, cases };
}

// ─── Flat operational list (GET /api/ancillary-documents) ───────────
export type DocumentsListQuery = DocumentsProjectionQuery & {
  serviceType?: string;
  documentKind?: string;
  documentStatus?: string;
  limit?: number;
  // Keyset cursor: return rows with reference id strictly less than this
  // (paired with the deterministic actualCreatedAt DESC, id DESC ordering).
  cursor?: number;
};

export type DocumentsListResult = {
  flagOff: boolean;
  items: AncillaryDocumentView[];
  nextCursor: number | null;
};

const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 500;

/**
 * Flat, deterministically-ordered, bounded list for the global operational
 * view. Ordering: actualCreatedAt DESC, then reference id DESC. Feature OFF →
 * zero reads. Another clinic's rows are never surfaced (repo + guard here).
 */
export async function getAncillaryDocumentsList(
  query: DocumentsListQuery,
): Promise<DocumentsListResult> {
  if (!featureFlags.unifiedAncillaryDocuments) return { flagOff: true, items: [], nextCursor: null };

  const limit = Math.min(Math.max(1, query.limit ?? LIST_DEFAULT_LIMIT), LIST_MAX_LIMIT);
  const filters: ClinicDocumentSearchFilters = { clinicId: query.clinicId, limit: LIST_MAX_LIMIT };
  if (query.ancillaryCaseId != null) filters.ancillaryCaseId = query.ancillaryCaseId;
  if (query.patientScreeningId != null) filters.patientScreeningId = query.patientScreeningId;
  if (query.executionCaseId != null) filters.executionCaseId = query.executionCaseId;
  if (query.globalPlexusPatientId != null) filters.globalPlexusPatientId = query.globalPlexusPatientId;
  if (query.serviceType != null) filters.serviceType = query.serviceType;
  if (query.documentKind != null) filters.documentKind = query.documentKind as never;
  if (query.documentStatus != null) filters.documentStatus = query.documentStatus;

  const refs = await searchClinicReferences(filters);
  const includeHistory = query.includeHistory ?? true;
  let scoped = refs.filter((r) => r.clinicId === query.clinicId);
  if (!includeHistory) scoped = scoped.filter(isCurrentRef);

  // Deterministic ordering: actualCreatedAt DESC, then reference id DESC.
  scoped.sort((a, b) => b.actualCreatedAt.getTime() - a.actualCreatedAt.getTime() || b.id - a.id);
  if (query.cursor != null) scoped = scoped.filter((r) => r.id < query.cursor!);

  const page = scoped.slice(0, limit);
  const nextCursor = scoped.length > limit ? page[page.length - 1].id : null;
  return { flagOff: false, items: page.map(toView), nextCursor };
}
