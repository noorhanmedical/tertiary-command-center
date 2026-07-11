import { db } from "../../db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { documents } from "@shared/schema/documents";
import { ancillaryDocumentTemplates } from "@shared/schema/ancillaryDocumentTemplates";
import { listCaseDocumentReadinessForCases } from "../../repositories/documentReadiness.repo";
import { getExecutionCaseById, getExecutionCaseByScreeningId } from "../../repositories/executionCase.repo";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import {
  READINESS_DOC_INFORMED_CONSENT,
  READINESS_DOC_SCREENING_FORM,
  READINESS_DOC_BRAINWAVE_PDF,
  READINESS_DOC_REPORT,
  isComplete as isReadinessComplete,
  requirementsForService,
  type ReadinessItemState,
} from "./ancillaryReadinessRules";

// Re-export the pure surface so consumers keep one import path.
export {
  READINESS_DOC_INFORMED_CONSENT,
  READINESS_DOC_SCREENING_FORM,
  READINESS_DOC_BRAINWAVE_PDF,
  READINESS_DOC_REPORT,
  requirementsForService,
  type ReadinessItemState,
} from "./ancillaryReadinessRules";

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
};

type AncillaryRowLike = {
  id: string | number;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  serviceType?: string | null;
};

// isComplete + COMPLETE_STATUSES + requirementsForService moved to
// ./ancillaryReadinessRules.ts (pure, no DB). Local alias below so the
// existing call sites in this file keep reading naturally.
const isComplete = isReadinessComplete;

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

// requirementsForService moved to ./ancillaryReadinessRules.ts (pure, no DB).
// Re-exported at the top of this file so downstream imports keep working.

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

  // Index readiness statuses by case key + documentType. We key on both
  // executionCaseId and patientScreeningId so either link resolves the row.
  const statusByKey = new Map<string, string>();
  const put = (prefix: string, id: number | null | undefined, docType: string, status: string) => {
    if (id == null) return;
    statusByKey.set(`${prefix}:${id}:${docType}`, status);
  };
  for (const r of readinessRows) {
    put("ec", r.executionCaseId, r.documentType, r.documentStatus);
    put("ps", r.patientScreeningId, r.documentType, r.documentStatus);
  }
  const lookup = (row: AncillaryRowLike, docType: string): string | undefined => {
    if (row.executionCaseId != null) {
      const v = statusByKey.get(`ec:${row.executionCaseId}:${docType}`);
      if (v != null) return v;
    }
    if (row.patientScreeningId != null) {
      return statusByKey.get(`ps:${row.patientScreeningId}:${docType}`);
    }
    return undefined;
  };

  for (const row of rows) {
    const req = requirementsForService(row.serviceType);

    const informedConsent: ReadinessItemState = req.informedConsent
      ? isComplete(lookup(row, READINESS_DOC_INFORMED_CONSENT))
        ? "complete"
        : "missing"
      : "not_required";

    const screeningForm: ReadinessItemState = req.screeningForm
      ? isComplete(lookup(row, READINESS_DOC_SCREENING_FORM))
        ? "complete"
        : "missing"
      : "not_required";

    const brainwavePdf: ReadinessItemState = req.brainwavePdf
      ? isComplete(lookup(row, READINESS_DOC_BRAINWAVE_PDF))
        ? "complete"
        : "missing"
      : "not_required";

    // Report applies to every ancillary. For BrainWave the result lives under
    // the dedicated brainwave_pdf item, so treat either as satisfying report.
    const report: ReadinessItemState =
      isComplete(lookup(row, READINESS_DOC_REPORT)) ||
      (req.brainwavePdf && isComplete(lookup(row, READINESS_DOC_BRAINWAVE_PDF)))
        ? "complete"
        : "missing";

    result.set(String(row.id), {
      informedConsent,
      screeningForm,
      brainwavePdf,
      report,
      informedConsentDocId: req.informedConsent ? informedConsentDocId : null,
      screeningFormDocId: req.screeningForm
        ? screeningDocByCategory.get(req.category) ?? null
        : null,
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
