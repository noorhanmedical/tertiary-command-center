import { db } from "../../db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { documents } from "@shared/schema/documents";
import { ancillaryDocumentTemplates } from "@shared/schema/ancillaryDocumentTemplates";
import { listCaseDocumentReadinessForCases } from "../../repositories/documentReadiness.repo";
import { getExecutionCaseById, getExecutionCaseByScreeningId } from "../../repositories/executionCase.repo";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import { readinessCountsForSchedule } from "./ancillaryReadinessRules";
import {
  buildReadinessIndex,
  resolveReadinessRow,
  consentScopeForCategory,
  type ResolutionScope,
} from "./ancillaryReadinessKeying";
import type { CaseDocumentReadiness } from "@shared/schema/documentReadiness";

type CaseReadinessRow = CaseDocumentReadiness;

/** Provenance for a completed readiness item (who/when), surfaced to the UI. */
export type ReadinessProvenance = {
  completedAt: string | null;
  completedByUserId: string | null;
};

// Canonical readiness document-type keys persisted in case_document_readiness.
export const READINESS_DOC_INFORMED_CONSENT = "informed_consent";
export const READINESS_DOC_SCREENING_FORM = "screening_form";
export const READINESS_DOC_BRAINWAVE_PDF = "brainwave_pdf";
export const READINESS_DOC_REPORT = "report";

// Any of these documentStatus values count as "the item is done".
const COMPLETE_STATUSES = new Set([
  "complete",
  "completed",
  "uploaded",
  "approved",
  "generated",
]);

export type ReadinessItemState = "complete" | "missing" | "not_required";

export type AncillaryReadinessSummary = {
  informedConsent: ReadinessItemState;
  screeningForm: ReadinessItemState;
  brainwavePdf: ReadinessItemState;
  // Report (result file) applies to every ancillary and is patient-specific
  // (no library template). "complete" once a report has been uploaded for the
  // case; "missing" until then.
  report: ReadinessItemState;
  informedConsentDocId: number | null;
  screeningFormDocId: number | null;
  // Provenance for the completed items (who/when), when available. Null when
  // the item is missing / not_required or the source row has no provenance.
  informedConsentProvenance: ReadinessProvenance | null;
  screeningFormProvenance: ReadinessProvenance | null;
  reportProvenance: ReadinessProvenance | null;
  // True when this row has NO execution-case link and readiness could only be
  // resolved (if at all) by the looser patient key — an honest "legacy" signal
  // the UI can surface instead of implying episode-accurate state.
  legacyUnlinked: boolean;
};

type AncillaryRowLike = {
  id: string | number;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  /**
   * The durable per-service ancillary occurrence id (patient_ancillary_cases.id).
   * Preferred, when present, as the ownership key for BrainWave / VitalWave
   * consent and for Report — so a specific occurrence's readiness never bleeds
   * across occurrences. Null in the pre-canonical (flag-off) world, where the
   * resolver falls back to (executionCaseId + exact serviceType). Ultrasound
   * consent is deliberately NOT keyed by this — it is shared across ultrasound
   * studies of the same visit/execution case (see the resolver below).
   */
  ancillaryCaseId?: number | null;
  serviceType?: string | null;
  /**
   * The appointment's scheduled date (YYYY-MM-DD), when the caller knows it.
   * When supplied, a completed readiness item only counts if it was completed
   * ON/AFTER this date — mirroring the clinic-portal `consentForTest` dated
   * rule so a stale (pre-scheduled-date) completion on the SAME case does not
   * mark a new visit ready. This is NOT an expiry period: there is no upper
   * bound, only the same on/after-scheduledDate lower bound the clinic path
   * already enforces. When omitted (e.g. the billing gate, which has no
   * appointment date), the dated guard is skipped and behavior is unchanged.
   */
  scheduledDate?: string | null;
};

function isComplete(status: string | null | undefined): boolean {
  return status != null && COMPLETE_STATUSES.has(status.toLowerCase());
}

/**
 * A completed readiness row COUNTS only when it satisfies the dated rule for
 * the row's appointment (see readinessCountsForSchedule in the pure rules
 * module). Thin adapter that extracts completedAt from the row.
 */
function completedOnOrAfterScheduled(
  r: CaseReadinessRow | undefined,
  scheduledDate: string | null | undefined,
): boolean {
  if (!r) return false;
  const completedAtIso = r.completedAt ? new Date(r.completedAt).toISOString() : null;
  return readinessCountsForSchedule(r.documentStatus, completedAtIso, scheduledDate);
}

/** Latest non-deleted, non-superseded informed-consent library document id. */
async function resolveInformedConsentDocId(): Promise<number | null> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.kind, "informed_consent"),
        isNull(documents.deletedAt),
        isNull(documents.supersededByDocumentId),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Map of ancillary category → screening-form library document id, derived
 *  from active ancillary_document_templates rows. */
async function resolveScreeningFormDocByCategory(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      serviceType: ancillaryDocumentTemplates.serviceType,
      documentId: ancillaryDocumentTemplates.documentId,
    })
    .from(ancillaryDocumentTemplates)
    .where(
      and(
        eq(ancillaryDocumentTemplates.documentType, "screening_form"),
        eq(ancillaryDocumentTemplates.active, true),
      ),
    );

  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.documentId == null) continue;
    const category = getAncillaryCategory(r.serviceType ?? "");
    if (!map.has(category)) map.set(category, r.documentId);
  }
  return map;
}

/** Per-service requirement flags: which of the three readiness items apply. */
export function requirementsForService(serviceType: string | null | undefined): {
  informedConsent: boolean;
  screeningForm: boolean;
  brainwavePdf: boolean;
  category: ReturnType<typeof getAncillaryCategory>;
} {
  const category = getAncillaryCategory(serviceType ?? "");
  return {
    // Informed consent is required for every ancillary patient.
    informedConsent: true,
    // Screening form is service-specific (BrainWave / VitalWave).
    screeningForm: category === "brainwave" || category === "vitalwave",
    // BrainWave Result PDF only applies to BrainWave.
    brainwavePdf: category === "brainwave",
    category,
  };
}

/**
 * Build a readiness summary for each ancillary appointment row. Resolves
 * persisted case_document_readiness rows (batched) plus the library document
 * ids that back the informed-consent and screening-form previews.
 *
 * Returns a Map keyed by String(row.id).
 */
export async function buildAncillaryReadinessSummaries(
  rows: AncillaryRowLike[],
): Promise<Map<string, AncillaryReadinessSummary>> {
  const result = new Map<string, AncillaryReadinessSummary>();
  if (rows.length === 0) return result;

  const executionCaseIds = rows
    .map((r) => r.executionCaseId)
    .filter((v): v is number => v != null);
  const patientScreeningIds = rows
    .map((r) => r.patientScreeningId)
    .filter((v): v is number => v != null);

  const [readinessRows, informedConsentDocId, screeningDocByCategory] = await Promise.all([
    listCaseDocumentReadinessForCases({ executionCaseIds, patientScreeningIds }),
    resolveInformedConsentDocId(),
    resolveScreeningFormDocByCategory(),
  ]);

  // Index readiness rows by case key + SERVICE + documentType. Keying on the
  // service (normalized to its ancillary category) enforces the strict rule:
  // a consent/screening completed for one service must NOT mark a different
  // service complete on the same case. We also retain the row itself so we can
  // surface provenance (completedAt / uploadedByUserId). We key on both
  // executionCaseId and patientScreeningId so either link resolves the row,
  // but the lookup below prefers case-scoped and never bleeds across episodes.
  // readinessRows arrive newest-first (createdAt DESC from
  // listCaseDocumentReadinessForCases). When multiple rows share the same
  // case+service+docType key (e.g. a document re-marked across visits), keep
  // the NEWEST — set the key only if it is not already present. Previously the
  // last-iterated (OLDEST) row won, which let a stale completion shadow a
  // fresher one; combined with the dated guard that would incorrectly mark a
  // current, valid completion as missing.
  // Key/scope resolution is factored into the pure ancillaryReadinessKeying
  // module (deterministically unit-tested). This layer only supplies the
  // DB-read rows and then applies the dated guard below.
  const rowByKey = buildReadinessIndex(readinessRows);
  // Episode + service isolation (Option A + strict consent rule). Resolution:
  //   1. When the row carries an executionCaseId, resolve ONLY by the
  //      case+service key — never fall back to patientScreeningId — so a prior
  //      same-service episode's completion cannot bleed into a new episode
  //      (e.g. 2025 vs 2026 BrainWave).
  //   2. The service is matched by ancillary CATEGORY so "BrainWave" consent
  //      never satisfies "Ultrasound", even on a multi-service case.
  //   3. The patientScreeningId key is used ONLY for legacy rows with no
  //      execution-case link at all.
  // Resolution scope per Decision 1:
  //   "service"  — the requirement belongs to the SPECIFIC ancillary occurrence
  //                (BrainWave/VitalWave consent, screening, report, brainwave_pdf).
  //                Prefers the durable ancillaryCaseId key, else (executionCase +
  //                exact serviceType), else (patientScreening + exact serviceType).
  //   "category" — the requirement is shared across studies of the same category
  //                in the same visit (ULTRASOUND consent only). Keeps the prior
  //                (executionCase + category) behavior so one ultrasound consent
  //                covers Echo + Carotid + AAA of the SAME execution case.
  // In BOTH scopes: when an executionCaseId is present we NEVER fall back to the
  // patientScreening key, so a prior episode's completion cannot bleed in.
  const lookupRow = (
    row: AncillaryRowLike,
    docType: string,
    scope: ResolutionScope = "category",
  ): CaseReadinessRow | undefined => resolveReadinessRow(rowByKey, row, docType, scope);

  for (const row of rows) {
    const req = requirementsForService(row.serviceType);
    const sched = row.scheduledDate ?? null;

    // A readiness item is "complete" only when its persisted row is complete
    // AND satisfies the dated on/after-scheduledDate guard (when a scheduled
    // date is supplied). Occurrence/service keying isolates by the specific
    // ancillary; the dated guard blocks a stale same-case completion from a
    // prior visit.
    const dated = (docType: string, scope: ResolutionScope): boolean =>
      completedOnOrAfterScheduled(lookupRow(row, docType, scope), sched);

    // Consent ownership (Decision 1): BrainWave / VitalWave consent belongs to
    // the specific occurrence (service scope → prefers ancillaryCaseId); an
    // ultrasound consent is shared across ultrasound studies of the same visit
    // (category scope).
    const consentScope: ResolutionScope = consentScopeForCategory(req.category);

    const informedConsent: ReadinessItemState = req.informedConsent
      ? dated(READINESS_DOC_INFORMED_CONSENT, consentScope)
        ? "complete"
        : "missing"
      : "not_required";

    const screeningForm: ReadinessItemState = req.screeningForm
      ? dated(READINESS_DOC_SCREENING_FORM, "service")
        ? "complete"
        : "missing"
      : "not_required";

    const brainwavePdf: ReadinessItemState = req.brainwavePdf
      ? dated(READINESS_DOC_BRAINWAVE_PDF, "service")
        ? "complete"
        : "missing"
      : "not_required";

    // Report belongs to the specific ancillary occurrence (service scope), so an
    // Echo report never satisfies a Carotid report on the same execution case.
    // For BrainWave the result lives under the dedicated brainwave_pdf item, so
    // treat either as satisfying report.
    const reportRow = lookupRow(row, READINESS_DOC_REPORT, "service");
    const brainwaveRow = lookupRow(row, READINESS_DOC_BRAINWAVE_PDF, "service");
    const report: ReadinessItemState =
      completedOnOrAfterScheduled(reportRow, sched) ||
      (req.brainwavePdf && completedOnOrAfterScheduled(brainwaveRow, sched))
        ? "complete"
        : "missing";

    // Provenance (who/when) surfaced only for completed items.
    const provOf = (r: CaseReadinessRow | undefined): ReadinessProvenance | null =>
      r && isComplete(r.documentStatus)
        ? {
            completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
            completedByUserId: r.uploadedByUserId ?? null,
          }
        : null;

    result.set(String(row.id), {
      informedConsent,
      screeningForm,
      brainwavePdf,
      report,
      informedConsentDocId: req.informedConsent ? informedConsentDocId : null,
      screeningFormDocId: req.screeningForm
        ? screeningDocByCategory.get(req.category) ?? null
        : null,
      informedConsentProvenance:
        informedConsent === "complete"
          ? provOf(lookupRow(row, READINESS_DOC_INFORMED_CONSENT, consentScope))
          : null,
      screeningFormProvenance:
        screeningForm === "complete"
          ? provOf(lookupRow(row, READINESS_DOC_SCREENING_FORM, "service"))
          : null,
      reportProvenance:
        report === "complete" ? provOf(reportRow ?? brainwaveRow) : null,
      // Honest legacy signal: the row has no execution-case link, so readiness
      // is not episode-accurate (only a patient-wide key was available).
      legacyUnlinked: row.executionCaseId == null,
    });
  }

  return result;
}

export type ReadinessGateResult = {
  ok: boolean;
  missing: string[];
};

/**
 * Evaluate whether all required readiness items for a case are complete.
 * Used by the billing gate. Resolves the execution case from either id and
 * reads persisted case_document_readiness rows for the supplied serviceType.
 */
export async function evaluateCaseReadinessGate(input: {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  serviceType: string;
}): Promise<ReadinessGateResult> {
  const req = requirementsForService(input.serviceType);

  // Resolve the execution case so we can scope readiness rows reliably.
  let executionCaseId = input.executionCaseId ?? null;
  let patientScreeningId = input.patientScreeningId ?? null;

  if (executionCaseId != null) {
    const ec = await getExecutionCaseById(executionCaseId);
    if (ec && patientScreeningId == null) patientScreeningId = ec.patientScreeningId ?? null;
  } else if (patientScreeningId != null) {
    const ec = await getExecutionCaseByScreeningId(patientScreeningId);
    if (ec) executionCaseId = ec.id;
  }

  // Without any case linkage we cannot evaluate readiness — allow (the gate
  // only blocks when there is a resolvable ancillary case to check).
  if (executionCaseId == null && patientScreeningId == null) {
    return { ok: true, missing: [] };
  }

  const summaries = await buildAncillaryReadinessSummaries([
    {
      id: "gate",
      executionCaseId,
      patientScreeningId,
      serviceType: input.serviceType,
    },
  ]);
  const summary = summaries.get("gate");
  if (!summary) return { ok: true, missing: [] };

  const missing: string[] = [];
  if (req.informedConsent && summary.informedConsent !== "complete") {
    missing.push(READINESS_DOC_INFORMED_CONSENT);
  }
  if (req.screeningForm && summary.screeningForm !== "complete") {
    missing.push(READINESS_DOC_SCREENING_FORM);
  }
  if (req.brainwavePdf && summary.brainwavePdf !== "complete") {
    missing.push(READINESS_DOC_BRAINWAVE_PDF);
  }

  return { ok: missing.length === 0, missing };
}
