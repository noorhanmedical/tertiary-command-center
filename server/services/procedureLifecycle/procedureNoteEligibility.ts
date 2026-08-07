/**
 * Phase 2F — centralized canonical Procedure Note eligibility.
 *
 * A Procedure Note (procedure_notes, note_type='post_procedure_note') is
 * eligible ONLY when BOTH:
 *   1. The exact ancillary procedure is COMPLETE — a canonical procedure_events
 *      row for THIS exact ancillary case (same clinic) with
 *      procedure_status='complete' and a real completed_at instant.
 *   2. A CURRENT canonical report is associated with THIS exact ancillary case
 *      AND service — an ancillary_document_references row, documentKind='report',
 *      same clinic, same serviceType, not superseded, acceptable status.
 *
 * Both are required. Procedure-complete-without-report and
 * report-without-procedure are each ineligible. Another case's report, another
 * service's report, and a superseded/voided report never qualify. A cancelled /
 * no_show procedure event is not a completion; a doctor_visit and mere
 * scheduling never produce a completed procedure event, so they never count.
 * Mandatory consent may block procedure EXECUTION upstream but is NOT a third
 * eligibility condition once a valid completion + report exist.
 *
 * We never fabricate completion/report evidence, never backdate a timestamp,
 * and never auto-sign. Feature OFF ⇒ ZERO Phase 2F reads.
 */

import { db } from "../../db";
import { and, desc, eq } from "drizzle-orm";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { ancillaryDocumentReferences } from "@shared/schema/ancillaryDocuments";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { procedureNoteRuntimeEnabled } from "../../lib/featureFlags";

export type ProcedureNoteEligibilityInput = {
  clinicId: number;
  ancillaryCaseId: number;
};

export type ProcedureNoteEligibilityResult = {
  eligible: boolean;
  procedureComplete: boolean;
  reportAssociated: boolean;
  qualifyingProcedureEventId?: number;
  qualifyingReportReferenceId?: number;
  // The immutable completion instant of the qualifying procedure event.
  procedureCompletedAt?: Date | null;
  // The immutable canonical source of the qualifying report reference.
  reportSourceTable?: string;
  reportSourceId?: number;
  serviceType: string | null;
  reasons: string[];
  warnings: string[];
  ancillaryCaseId: number;
  clinicMismatch?: boolean;
  caseNotFound?: boolean;
  flagOff?: boolean;
  migrationMissing?: boolean;
};

// A report reference is "current" for eligibility only when it is not
// superseded AND carries an acceptable positive status. pending /
// pending_signature / superseded / voided are NOT current.
// K3 — the SINGLE source of truth for which report document statuses the live
// eligibility service accepts. The backfill DRY-RUN classifier imports this exact set
// so its plan reports precisely what APPLY (the live ensure) would consider eligible —
// never a broader set that overstates applicability.
export const ACCEPTABLE_REPORT_STATUSES = new Set(["uploaded", "completed", "approved"]);

// Schema-element-absent codes → truthful migration_missing (never a false
// "no evidence"). 42P01 undefined_table, 42703 undefined_column.
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

function isMigrationMissing(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code != null && MIGRATION_MISSING_CODES.has(code);
}

export async function evaluateProcedureNoteEligibility(
  input: ProcedureNoteEligibilityInput,
): Promise<ProcedureNoteEligibilityResult> {
  const base: ProcedureNoteEligibilityResult = {
    eligible: false, procedureComplete: false, reportAssociated: false,
    reasons: [], warnings: [], ancillaryCaseId: input.ancillaryCaseId, serviceType: null,
  };
  // Full runtime gate (all three flags) ⇒ otherwise zero Phase 2F reads.
  // Eligibility reads procedure_events (populated by lifecycle) + the canonical
  // report reference (Phase 2E index), so partial enablement must not read.
  if (!procedureNoteRuntimeEnabled()) {
    return { ...base, flagOff: true, reasons: ["procedure_note_flag_off"] };
  }

  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  if (!acase) return { ...base, caseNotFound: true, reasons: ["ancillary_case_not_found"] };
  if (acase.clinicId !== input.clinicId) {
    return { ...base, serviceType: acase.serviceType, clinicMismatch: true, reasons: ["cross_clinic_denied"] };
  }
  const serviceType = acase.serviceType;
  const reasons: string[] = [];

  try {
    // ── Condition 1 — completed canonical procedure event for THIS case ──
    const proc = await evaluateProcedureCompletion(input.clinicId, input.ancillaryCaseId);
    if (!proc.procedureComplete) reasons.push(proc.reason!);

    // ── Condition 2 — current report for THIS exact case + service ──
    const report = await evaluateReportAssociation(input.clinicId, input.ancillaryCaseId, serviceType);
    if (!report.reportAssociated) reasons.push(report.reason!);

    return {
      eligible: proc.procedureComplete && report.reportAssociated,
      procedureComplete: proc.procedureComplete,
      reportAssociated: report.reportAssociated,
      qualifyingProcedureEventId: proc.eventId,
      procedureCompletedAt: proc.completedAt ?? undefined,
      qualifyingReportReferenceId: report.referenceId,
      reportSourceTable: report.sourceTable,
      reportSourceId: report.sourceId,
      serviceType,
      reasons,
      warnings: [],
      ancillaryCaseId: input.ancillaryCaseId,
    };
  } catch (e) {
    if (isMigrationMissing(e)) {
      return { ...base, serviceType, migrationMissing: true, reasons: ["migration_missing"] };
    }
    throw e;
  }
}

/** Deterministic completion evidence: the completed procedure_events row that
 *  belongs to EXACTLY this ancillary case + clinic (never name/first/newest;
 *  never a cancelled/no_show/in_progress row). Picks the latest completed_at. */
async function evaluateProcedureCompletion(
  clinicId: number,
  ancillaryCaseId: number,
): Promise<{ procedureComplete: boolean; eventId?: number; completedAt?: Date | null; reason?: string }> {
  const rows = await db
    .select()
    .from(procedureEvents)
    .where(and(
      eq(procedureEvents.ancillaryCaseId, ancillaryCaseId),
      eq(procedureEvents.clinicId, clinicId),
    ))
    .orderBy(desc(procedureEvents.completedAt));
  // Defensive: never trust a returned row's ownership — re-verify clinic+case.
  const own = rows.filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId);
  if (own.length === 0) return { procedureComplete: false, reason: "procedure_event_missing" };
  const completed = own.filter((r) => r.procedureStatus === "complete" && r.completedAt != null);
  if (completed.length === 0) return { procedureComplete: false, reason: "procedure_not_complete" };
  // The migration-0054 partial unique guarantees ≤1 canonical event per case.
  // More than one completed case-linked event is pre-backfill corruption — we
  // surface it for reconciliation and NEVER pick the latest to hide ambiguity.
  if (completed.length > 1) return { procedureComplete: false, reason: "procedure_event_ambiguous" };
  const winner = completed[0];
  return { procedureComplete: true, eventId: winner.id, completedAt: winner.completedAt };
}

/** Deterministic report evidence: a current canonical report reference for
 *  EXACTLY this ancillary case + service (same clinic). Distinguishes
 *  missing / not-current / another-case / another-service. */
async function evaluateReportAssociation(
  clinicId: number,
  ancillaryCaseId: number,
  serviceType: string,
): Promise<{ reportAssociated: boolean; referenceId?: number; sourceTable?: string; sourceId?: number; reason?: string }> {
  const rows = await db
    .select()
    .from(ancillaryDocumentReferences)
    .where(and(
      eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId),
      eq(ancillaryDocumentReferences.clinicId, clinicId),
      eq(ancillaryDocumentReferences.documentKind, "report"),
    ))
    .orderBy(desc(ancillaryDocumentReferences.actualCreatedAt));
  if (rows.length === 0) return { reportAssociated: false, reason: "report_missing" };
  // Defensive ownership re-check — never associate another case/clinic's report.
  const own = rows.filter((r) => r.clinicId === clinicId && r.ancillaryCaseId === ancillaryCaseId);
  if (own.length === 0) return { reportAssociated: false, reason: "report_case_mismatch" };
  const current = own.filter(
    (r) => r.supersededAt == null && ACCEPTABLE_REPORT_STATUSES.has(r.documentStatus),
  );
  if (current.length === 0) return { reportAssociated: false, reason: "report_not_current" };
  const exactService = current.filter((r) => r.serviceType === serviceType);
  if (exactService.length === 0) return { reportAssociated: false, reason: "report_service_mismatch" };
  const winner = exactService[0]; // already ordered by actualCreatedAt DESC
  return { reportAssociated: true, referenceId: winner.id, sourceTable: winner.sourceTable, sourceId: winner.sourceId };
}
