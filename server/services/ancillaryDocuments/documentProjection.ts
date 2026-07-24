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
import type { AncillaryDocumentReference } from "@shared/schema/ancillaryDocuments";

export type AncillaryDocumentView = {
  ancillaryDocumentReferenceId: number;
  documentKind: string;
  sourceSystem: string | null;
  sourceTable: string;
  sourceId: number;
  documentStatus: string;
  effectiveClinicalDate: string | null;
  actualCreatedAt: string;
  signedAt: string | null;
  supersededAt: string | null;
  downloadReference: string | null;
  readiness: "ready" | "pending" | "history";
  warnings: string[];
};

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

function toView(ref: AncillaryDocumentReference): AncillaryDocumentView {
  return {
    ancillaryDocumentReferenceId: ref.id,
    documentKind: ref.documentKind,
    sourceSystem: ref.sourceSystem,
    sourceTable: ref.sourceTable,
    sourceId: ref.sourceId,
    documentStatus: ref.documentStatus,
    effectiveClinicalDate: ref.effectiveClinicalDate ? ref.effectiveClinicalDate.toISOString() : null,
    actualCreatedAt: ref.actualCreatedAt.toISOString(),
    signedAt: ref.signedAt ? ref.signedAt.toISOString() : null,
    supersededAt: ref.supersededAt ? ref.supersededAt.toISOString() : null,
    // A stable source pointer — never document bytes.
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
