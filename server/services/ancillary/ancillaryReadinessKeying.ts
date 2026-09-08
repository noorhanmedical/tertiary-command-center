// Ancillary readiness — PURE key/scope resolution.
//
// Zero I/O, zero DB imports. This isolates the exact key-generation and
// scope-selection logic that buildAncillaryReadinessSummaries uses to decide
// WHICH persisted case_document_readiness row (if any) owns a given readiness
// item for a specific ancillary occurrence. Keeping it pure makes the ownership
// rules deterministically testable without a live database.
//
// Ownership rules (Decision 1):
//   • "service"  scope — the requirement belongs to the SPECIFIC ancillary
//     occurrence: BrainWave/VitalWave consent, screening, report, brainwave_pdf.
//     Resolution prefers the durable per-occurrence key (ancillaryCaseId), then
//     (executionCase + exact canonical serviceType), then (patientScreening +
//     exact serviceType).
//   • "category" scope — the requirement is SHARED across studies of the same
//     category in the same visit: ULTRASOUND consent only. Resolution uses
//     (executionCase + category), then (patientScreening + category).
//   • In BOTH scopes, when an executionCaseId is present we NEVER fall back to
//     the patientScreening key, so a prior episode's completion cannot bleed in.
//
// The dated guard (readinessCountsForSchedule) is applied by the caller AFTER
// this resolution; it lives in ancillaryReadinessRules.ts.

import { getAncillaryCategory } from "@shared/ancillaryCategory";
import { resolveCanonicalServiceType } from "@shared/canonicalService";

export type ResolutionScope = "service" | "category";

/** Minimal shape needed to INDEX a persisted readiness row. */
export type IndexableReadinessRow = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
  documentType: string;
  metadata?: unknown;
};

/** Minimal shape of the appointment/occurrence row being RESOLVED. */
export type ResolvableAncillaryRow = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
};

/** Canonical, lowercased per-service key fragment (drift-proof: "Echo" and
 *  "Echocardiogram TTE" collapse to the same fragment). */
export function svcKey(raw: string | null | undefined): string {
  return resolveCanonicalServiceType(raw ?? "").toLowerCase();
}

/** Reads the durable per-occurrence id (patient_ancillary_cases.id). Prefers the
 *  canonical `ancillary_case_id` column (migration 0081); falls back to the id
 *  the legacy write path stamped into metadata.ancillaryCaseId for older rows. */
export function readinessRowAncillaryCaseId(r: { ancillaryCaseId?: number | null; metadata?: unknown }): number | null {
  if (typeof r.ancillaryCaseId === "number" && Number.isFinite(r.ancillaryCaseId)) return r.ancillaryCaseId;
  const meta = (r.metadata ?? null) as Record<string, unknown> | null;
  const v = meta?.ancillaryCaseId;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Consent scope by category: ultrasound is shared (category); every other
 *  service is per-occurrence (service). */
export function consentScopeForCategory(category: string): ResolutionScope {
  return category === "ultrasound" ? "category" : "service";
}

/**
 * The persistence uniqueness tuple the write path (portalCaseReadiness.ts /
 * documentReadiness.ts upsert) keys on. Occurrence-aware since migration 0081:
 * the canonical occurrence id (ancillary_case_id) participates in the key, so
 * two occurrences of the same service on one execution case get DISTINCT keys
 * and are persisted as independent readiness rows (no collapse). Occurrence-
 * less (legacy) rows use a null occurrence segment and keep single-occurrence
 * behavior.
 */
export function readinessUpsertKey(row: {
  executionCaseId?: number | null;
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
  documentType: string;
}): string {
  return `${row.executionCaseId ?? "null"}:${row.ancillaryCaseId ?? "null"}:${svcKey(row.serviceType)}:${row.documentType}`;
}

/**
 * Build the resolution index from persisted readiness rows. Rows are expected
 * newest-first; when multiple rows share a key we KEEP THE FIRST (newest) —
 * a stale completion must never shadow a fresher one.
 */
export function buildReadinessIndex<T extends IndexableReadinessRow>(
  rows: readonly T[],
): Map<string, T> {
  const idx = new Map<string, T>();
  const put = (
    prefix: string,
    id: number | null | undefined,
    frag: string,
    docType: string,
    r: T,
  ) => {
    if (id == null) return;
    const key = `${prefix}:${id}:${frag}:${docType}`;
    if (!idx.has(key)) idx.set(key, r);
  };
  for (const r of rows) {
    const cat = getAncillaryCategory(r.serviceType ?? "");
    const svc = svcKey(r.serviceType);
    // Category-scoped keys (ultrasound consent; legacy behavior preserved).
    put("ec", r.executionCaseId, cat, r.documentType, r);
    put("ps", r.patientScreeningId, cat, r.documentType, r);
    // Exact-service-scoped keys (per-occurrence proxy).
    put("ecs", r.executionCaseId, svc, r.documentType, r);
    put("pss", r.patientScreeningId, svc, r.documentType, r);
    // Durable per-occurrence key (present only when the canonical case id was
    // stamped onto the readiness row's metadata). Preferred over the proxy.
    put("ac", readinessRowAncillaryCaseId(r), svc, r.documentType, r);
  }
  return idx;
}

/** Resolve the persisted readiness row that owns `docType` for `row` at `scope`. */
export function resolveReadinessRow<T extends IndexableReadinessRow>(
  index: Map<string, T>,
  row: ResolvableAncillaryRow,
  docType: string,
  scope: ResolutionScope = "category",
): T | undefined {
  const cat = getAncillaryCategory(row.serviceType ?? "");
  const svc = svcKey(row.serviceType);
  if (scope === "service") {
    // Occurrence-scoped (P0, migration 0081): when the row being resolved
    // carries a canonical occurrence id, ONLY that occurrence's readiness row
    // may satisfy it. Do NOT fall back to the occurrence-agnostic
    // execution-case/screening service key — a sibling occurrence's completion
    // (same execution case + same service, different ancillary_case_id) would
    // otherwise leak in and mark a distinct occurrence complete.
    if (row.ancillaryCaseId != null) {
      return index.get(`ac:${row.ancillaryCaseId}:${svc}:${docType}`);
    }
    if (row.executionCaseId != null) {
      return index.get(`ecs:${row.executionCaseId}:${svc}:${docType}`);
    }
    if (row.patientScreeningId != null) {
      return index.get(`pss:${row.patientScreeningId}:${svc}:${docType}`);
    }
    return undefined;
  }
  if (row.executionCaseId != null) {
    return index.get(`ec:${row.executionCaseId}:${cat}:${docType}`);
  }
  if (row.patientScreeningId != null) {
    return index.get(`ps:${row.patientScreeningId}:${cat}:${docType}`);
  }
  return undefined;
}
