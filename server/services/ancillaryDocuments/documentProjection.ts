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
  searchClinicReferencesPage,
  type ClinicDocumentSearchFilters,
  type ReferencePageCursor,
} from "../../repositories/ancillaryDocuments.repo";
import type {
  AncillaryDocumentReference,
  AncillaryDocumentContractItem,
} from "@shared/schema/ancillaryDocuments";
import {
  resolveAuthorizedDownloadReference,
} from "./downloadReference";

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
    // The AUTHORIZED download/view route resolved from the stored metadata
    // pointer (allowlisted), or null. NEVER a fabricated sourceTable:sourceId,
    // a raw bucket key, a filesystem path, or an external URL.
    downloadReference: resolveAuthorizedDownloadReference(ref),
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
  // Opaque compound keyset cursor (base64url of {t: iso, i: id}). A string,
  // not a numeric id — decoded/validated in the service.
  cursor?: string;
};

export type DocumentsListResult = {
  flagOff: boolean;
  items: AncillaryDocumentView[];
  nextCursor: string | null;
};

/** Thrown when a client supplies a malformed cursor → route maps to 400. */
export class InvalidCursorError extends Error {
  code = "INVALID_CURSOR" as const;
  constructor() { super("invalid_cursor"); this.name = "InvalidCursorError"; }
}

const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 500;

// Compound cursor is opaque to clients: base64url({ t: ISO ts, i: id }).
export function encodeDocumentsCursor(c: ReferencePageCursor): string {
  const json = JSON.stringify({ t: c.actualCreatedAt.toISOString(), i: c.id });
  return Buffer.from(json, "utf8").toString("base64url");
}
export function decodeDocumentsCursor(raw: string): ReferencePageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const ts = new Date(parsed?.t);
    const id = Number(parsed?.i);
    if (Number.isNaN(ts.getTime()) || !Number.isInteger(id)) throw new Error("bad");
    return { actualCreatedAt: ts, id };
  } catch {
    throw new InvalidCursorError();
  }
}

/**
 * Flat, deterministically-ordered, keyset-paginated list for the global
 * operational view. All filtering/ordering/cursor/limit live in SQL (no fixed
 * 500-row prefetch). Ordering: actualCreatedAt DESC, id DESC. Feature OFF →
 * zero reads. A cursor only ever pages WITHIN the same clinic + filter set
 * (the filters + clinic are re-applied every call), so a cursor cannot leak
 * another clinic's rows.
 */
export async function getAncillaryDocumentsList(
  query: DocumentsListQuery,
): Promise<DocumentsListResult> {
  if (!featureFlags.unifiedAncillaryDocuments) return { flagOff: true, items: [], nextCursor: null };

  const limit = Math.min(Math.max(1, query.limit ?? LIST_DEFAULT_LIMIT), LIST_MAX_LIMIT);
  const cursor = query.cursor ? decodeDocumentsCursor(query.cursor) : null;

  const filters: Omit<ClinicDocumentSearchFilters, "limit"> = { clinicId: query.clinicId };
  if (query.ancillaryCaseId != null) filters.ancillaryCaseId = query.ancillaryCaseId;
  if (query.patientScreeningId != null) filters.patientScreeningId = query.patientScreeningId;
  if (query.executionCaseId != null) filters.executionCaseId = query.executionCaseId;
  if (query.globalPlexusPatientId != null) filters.globalPlexusPatientId = query.globalPlexusPatientId;
  if (query.serviceType != null) filters.serviceType = query.serviceType;
  if (query.documentKind != null) filters.documentKind = query.documentKind as never;
  if (query.documentStatus != null) filters.documentStatus = query.documentStatus;

  // includeHistory applied in SQL (currentOnly = !includeHistory).
  const currentOnly = (query.includeHistory ?? true) === false;
  const rows = await searchClinicReferencesPage({ filters, currentOnly, cursor, limit });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeDocumentsCursor({ actualCreatedAt: last.actualCreatedAt, id: last.id })
    : null;
  return { flagOff: false, items: page.map(toView), nextCursor };
}

// NOTE: a batched per-screening summary path was considered for a true
// parent-fed ACS/PCS model, but the portal shows ONE selected case at a time,
// so Phase 2E-B3 uses the single selected-case detail model
// (SelectedCaseOverview queries the EXACT ancillaryCaseId). No dead batch code
// is retained.
