/**
 * Phase 2E-B3 — canonical document SOURCE ADAPTERS for reference retries.
 *
 * A reference retry must load the EXACT canonical source row (by
 * source_table + source_id) and validate it before re-driving the reference
 * writer. Adapters resolve ownership from the source row's own columns only —
 * NEVER by patient name or facility name — and never copy file bytes.
 *
 * Only explicitly-supported source tables/types resolve; everything else
 * returns a structured, unresolved reason.
 */

import {
  getCaseDocumentReadinessById,
  findCaseDocumentReadinessCandidates,
} from "../../repositories/documentReadiness.repo";
import {
  listAncillaryCasesForScreening,
  listAncillaryCasesForExecutionCase,
  getAncillaryCaseById,
} from "../../repositories/ancillaryCases.repo";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";

const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);

export type CanonicalDocumentKind = "report" | "consent" | "screening_form";

export type CanonicalSourceDescriptor = {
  sourceTable: string;
  sourceId: number;
  clinicId: number | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string;
  documentKind: CanonicalDocumentKind;
  documentStatus: string;
  actualCreatedAt: Date;
  signedAt: Date | null;
  // Opaque pointer the allowlist download resolver validates (never bytes).
  downloadReference: string | null;
};

export type LoadSourceResult =
  | { ok: true; descriptor: CanonicalSourceDescriptor }
  | { ok: false; reason: "source_not_found" | "unsupported_source_table" | "source_type_mismatch" };

// The actual case_document_readiness.document_type → canonical kind values.
const DOC_TYPE_TO_KIND: Record<string, CanonicalDocumentKind> = {
  report: "report",
  informed_consent: "consent",
  screening_form: "screening_form",
};

// document_status values that make (re)linking invalid.
const INVALID_LINK_STATUSES = new Set(["voided", "deleted"]);

/** Map a retry action to the kind it must produce. */
export const ACTION_TO_KIND: Record<string, CanonicalDocumentKind> = {
  link_report: "report",
  link_consent: "consent",
  link_screening_form: "screening_form",
};

// The retry action → the case_document_readiness.document_type to discover.
const ACTION_TO_READINESS_TYPE: Record<string, string> = {
  link_report: "report",
  link_consent: "informed_consent",
  link_screening_form: "screening_form",
};

export type DiscoverSourceResult =
  | { ok: true; sourceTable: "case_document_readiness"; sourceId: number }
  | { ok: false; reason: "source_not_found" | "multiple_source_candidates" | "service_mismatch" | "cross_clinic_denied" | "service_unresolved" };

/**
 * Resolve the exact SERVICE + strongest execution/screening identity for a
 * source-less retry, using the ancillary case when known, else exactly one
 * active ancillary case for the identity. NEVER guesses across multiple
 * services or episodes.
 */
async function resolveServiceIdentity(args: {
  clinicId: number;
  ancillaryCaseId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
}): Promise<
  | { ok: true; serviceType: string; executionCaseId: number | null; patientScreeningId: number | null }
  | { ok: false; reason: "source_not_found" | "cross_clinic_denied" | "service_unresolved" }
> {
  if (args.ancillaryCaseId != null) {
    const acase = await getAncillaryCaseById(args.ancillaryCaseId);
    if (!acase) return { ok: false, reason: "source_not_found" };
    if (acase.clinicId !== args.clinicId) return { ok: false, reason: "cross_clinic_denied" };
    // Derive missing identity fields FROM the case.
    return {
      ok: true,
      serviceType: acase.serviceType,
      executionCaseId: args.executionCaseId ?? acase.executionCaseId ?? null,
      patientScreeningId: args.patientScreeningId ?? acase.originatingScreeningId ?? null,
    };
  }
  // No ancillary case named → derive from the active cases for the identity.
  let cases: PatientAncillaryCase[] = [];
  if (args.executionCaseId != null) cases = await listAncillaryCasesForExecutionCase(args.executionCaseId);
  else if (args.patientScreeningId != null) cases = await listAncillaryCasesForScreening(args.patientScreeningId);
  else return { ok: false, reason: "service_unresolved" };
  const active = cases.filter((c) => c.clinicId === args.clinicId && ACTIVE_LIFECYCLE.has(c.lifecycleStatus));
  if (active.length === 0) return { ok: false, reason: "source_not_found" };
  // Exactly one active case → unambiguous service + identity. Multiple
  // services OR multiple episodes → ambiguous (never guess).
  if (active.length !== 1) return { ok: false, reason: "service_unresolved" };
  const c = active[0];
  return {
    ok: true,
    serviceType: c.serviceType,
    executionCaseId: args.executionCaseId ?? c.executionCaseId ?? null,
    patientScreeningId: args.patientScreeningId ?? c.originatingScreeningId ?? null,
  };
}

/**
 * DETERMINISTIC source discovery for a source-less reference retry. Resolves
 * the exact service + strongest identity, then finds the ONE matching
 * case_document_readiness source. A missing documentId does NOT block indexing
 * (the readiness row itself is the canonical source; documentId only affects
 * downloadReference). NEVER chooses first/newest/arbitrary.
 */
export async function discoverCanonicalDocumentSource(args: {
  requestedAction: string;
  clinicId: number;
  ancillaryCaseId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
}): Promise<DiscoverSourceResult> {
  const readinessType = ACTION_TO_READINESS_TYPE[args.requestedAction];
  if (!readinessType) return { ok: false, reason: "source_not_found" };

  const resolved = await resolveServiceIdentity(args);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { serviceType, executionCaseId, patientScreeningId } = resolved;

  // Query by identity + type (NOT service) so a genuine service mismatch is
  // distinguishable from a missing source; the exact service filter is applied
  // in-code below.
  const candidates = await findCaseDocumentReadinessCandidates({
    clinicId: args.clinicId,
    documentType: readinessType,
    executionCaseId,
    patientScreeningId,
  });
  // documentId is NOT required — the readiness row IS the canonical source.
  const linkable = candidates.filter((c) => !INVALID_LINK_STATUSES.has(c.documentStatus));
  const serviceMatch = linkable.filter((c) => c.serviceType === serviceType);
  if (serviceMatch.length === 1) return { ok: true, sourceTable: "case_document_readiness", sourceId: serviceMatch[0].id };
  if (serviceMatch.length > 1) return { ok: false, reason: "multiple_source_candidates" };
  // Candidates exist for the identity but not the service → true mismatch.
  if (linkable.length > 0) return { ok: false, reason: "service_mismatch" };
  return { ok: false, reason: "source_not_found" };
}

/**
 * Load + normalize the exact canonical source. Ownership fields come from the
 * source row itself (clinic/screening/execution/service) — never inferred.
 */
export async function loadCanonicalDocumentSource(
  sourceTable: string | null,
  sourceId: number | null,
): Promise<LoadSourceResult> {
  if (sourceTable !== "case_document_readiness") return { ok: false, reason: "unsupported_source_table" };
  if (sourceId == null) return { ok: false, reason: "source_not_found" };

  const row = await getCaseDocumentReadinessById(sourceId);
  if (!row) return { ok: false, reason: "source_not_found" };

  const kind = DOC_TYPE_TO_KIND[row.documentType];
  if (!kind) return { ok: false, reason: "source_type_mismatch" };
  if (INVALID_LINK_STATUSES.has(row.documentStatus)) return { ok: false, reason: "source_type_mismatch" };

  const signedAt = kind === "consent" && row.documentStatus === "completed" ? (row.completedAt ?? null) : null;
  return {
    ok: true,
    descriptor: {
      sourceTable: "case_document_readiness",
      sourceId: row.id,
      clinicId: row.clinicId ?? null,
      patientScreeningId: row.patientScreeningId ?? null,
      executionCaseId: row.executionCaseId ?? null,
      serviceType: row.serviceType,
      documentKind: kind,
      documentStatus: row.documentStatus,
      actualCreatedAt: row.createdAt,
      signedAt,
      downloadReference: row.documentId != null ? `documents:${row.documentId}` : null,
    },
  };
}

export type ResolveCaseResult =
  | { kind: "one"; case: PatientAncillaryCase }
  | { kind: "no_case" | "multiple_cases" | "service_mismatch" };

/**
 * Deterministically resolve the ONE active ancillary case owning a source —
 * mirrors the reference writer's resolution but distinguishes a genuine
 * service mismatch (candidates exist for the identity but none match the
 * source's service) from a plain no-case. Never guesses first/newest.
 */
export async function resolveCaseForSource(src: CanonicalSourceDescriptor): Promise<ResolveCaseResult> {
  let candidates: PatientAncillaryCase[] = [];
  if (src.executionCaseId != null) candidates = await listAncillaryCasesForExecutionCase(src.executionCaseId);
  else if (src.patientScreeningId != null) candidates = await listAncillaryCasesForScreening(src.patientScreeningId);
  else return { kind: "no_case" };
  const active = candidates.filter((c) => ACTIVE_LIFECYCLE.has(c.lifecycleStatus));
  const matches = active.filter((c) => c.serviceType === src.serviceType);
  if (matches.length === 1) return { kind: "one", case: matches[0] };
  if (matches.length > 1) return { kind: "multiple_cases" };
  // No service match: distinguish "other services exist" (service mismatch)
  // from "no active cases at all" (no case yet).
  return active.length > 0 ? { kind: "service_mismatch" } : { kind: "no_case" };
}
