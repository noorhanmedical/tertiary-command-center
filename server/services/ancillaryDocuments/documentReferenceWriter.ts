/**
 * Phase 2E-B — canonical reference writer for report / consent /
 * screening_form.
 *
 * Called AFTER the canonical readiness source (case_document_readiness) has
 * committed. It indexes that immutable (source_table, source_id) into
 * ancillary_document_references — it NEVER copies file bytes, never creates a
 * second uploaded-file record, and never attaches by patient name.
 *
 * Ancillary-case resolution is DETERMINISTIC only: exactly one active case
 * matching (executionCase | screening) + serviceType + clinic. Zero or
 * multiple candidates → durable, PHI-free retry (never first/newest guess).
 * Cross-clinic attachment is denied. createReference is idempotent by
 * (source_table, source_id, kind), so repeat invocations reuse the row. The
 * function NEVER throws: the parent readiness write must remain truthful even
 * when indexing is deferred.
 */

import { featureFlags, procedureNoteRuntimeEnabled } from "../../lib/featureFlags";
import {
  createReference,
  recordAncillaryDocumentFailure,
} from "../../repositories/ancillaryDocuments.repo";
import {
  listAncillaryCasesForScreening,
  listAncillaryCasesForExecutionCase,
} from "../../repositories/ancillaryCases.repo";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import type { AncillaryDocumentKind } from "@shared/schema/ancillaryDocuments";

export type DocumentReferenceKind = "report" | "consent" | "screening_form";

const RETRY_ACTION: Record<DocumentReferenceKind, "link_report" | "link_consent" | "link_screening_form"> = {
  report: "link_report",
  consent: "link_consent",
  screening_form: "link_screening_form",
};

const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);

export type EnsureDocumentReferenceInput = {
  documentKind: DocumentReferenceKind;
  sourceTable: string;
  sourceId: number;
  serviceType: string;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
  // The clinic asserted by the caller (from the source context). When set it
  // MUST match the resolved case's clinic; a mismatch is denied.
  expectedClinicId?: number | null;
  documentStatus: string;
  effectiveClinicalDate?: Date | null;
  signedAt?: Date | null;
  // The SOURCE's own creation timestamp (case_document_readiness.created_at) —
  // preserved into the reference; never the retry/index time.
  actualCreatedAt?: Date | null;
  // A pointer to an already-authorized download/view route — never bytes.
  downloadReference?: string | null;
  actorUserId?: string | null;
  source: string;
};

export type EnsureDocumentReferenceResult =
  | { status: "skipped_flag_off" }
  | { status: "created"; referenceId: number; ancillaryCaseId: number }
  | { status: "reused_exact_source"; referenceId: number; ancillaryCaseId: number }
  // A DIFFERENT current source already holds this (case, kind) slot. NEVER
  // reused; the new source is never attached to the old reference id. A
  // source-specific retry is recorded (retryRecorded reflects persistence).
  | { status: "active_kind_conflict"; ancillaryCaseId: number; existingReferenceId: number; retryRecorded: boolean; warnings: string[] }
  | { status: "deferred_ambiguous_case"; reason: "no_case" | "multiple_cases"; retryRecorded: boolean; warnings: string[] }
  | { status: "cross_clinic_denied" }
  | { status: "deferred_reference"; retryRecorded: boolean }
  // The reference could not be indexed AND its durable retry could not be
  // persisted — reconciliation is NOT durable; caller must not claim it is.
  | { status: "retry_not_recorded"; warnings: string[] }
  | { status: "migration_missing" }
  | { status: "failed" };

/** Deterministically resolve the single owning ancillary case, or null. */
async function resolveOwningCase(
  input: EnsureDocumentReferenceInput,
): Promise<{ kind: "one"; case: PatientAncillaryCase } | { kind: "no_case" | "multiple_cases" }> {
  let candidates: PatientAncillaryCase[] = [];
  if (input.executionCaseId != null) {
    candidates = await listAncillaryCasesForExecutionCase(input.executionCaseId);
  } else if (input.patientScreeningId != null) {
    candidates = await listAncillaryCasesForScreening(input.patientScreeningId);
  } else {
    return { kind: "no_case" };
  }
  const matches = candidates.filter(
    (c) => c.serviceType === input.serviceType && ACTIVE_LIFECYCLE.has(c.lifecycleStatus),
  );
  if (matches.length === 0) return { kind: "no_case" };
  if (matches.length > 1) return { kind: "multiple_cases" };
  return { kind: "one", case: matches[0] };
}

async function recordReferenceRetry(
  input: EnsureDocumentReferenceInput,
  ancillaryCaseId: number | null,
  clinicId: number | null,
  errorCode: string,
): Promise<boolean> {
  if (clinicId == null) return false;
  try {
    await recordAncillaryDocumentFailure({
      clinicId,
      ancillaryCaseId,
      patientScreeningId: input.patientScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      documentKind: input.documentKind,
      sourceTable: input.sourceTable,
      sourceId: input.sourceId,
      requestedAction: RETRY_ACTION[input.documentKind],
      sourceSystem: input.source,
      errorCode,
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "reference_retry_record_failed",
      document_kind: input.documentKind, source_id: input.sourceId,
      code: (e as { code?: string })?.code ?? "ledger_write_failed",
    }));
    return false;
  }
}

/**
 * Phase 2F Hook B. Only a REPORT reference is a Procedure Note eligibility
 * signal (report is condition 2). AWAITED (no async DB task escapes the caller)
 * and non-throwing via the orchestration; a lazy dynamic import keeps this
 * Phase-2E writer decoupled from the Phase 2F module graph. Never affects the
 * reference result.
 */
async function fireProcedureNoteHookForReport(
  input: EnsureDocumentReferenceInput,
  ancillaryCaseId: number,
  clinicId: number,
): Promise<void> {
  if (input.documentKind !== "report") return;
  if (!procedureNoteRuntimeEnabled()) return;
  try {
    const { ensureCanonicalProcedureNoteForAncillaryCase } = await import(
      "../procedureLifecycle/procedureLifecycleOrchestration"
    );
    await ensureCanonicalProcedureNoteForAncillaryCase({
      clinicId,
      ancillaryCaseId,
      actorUserId: input.actorUserId ?? null,
      source: "report_associated_hook",
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "report_procedure_note_hook_failed",
      ancillary_case_id: ancillaryCaseId, code: (e as { code?: string })?.code ?? "unknown",
    }));
  }
}

export async function ensureAncillaryDocumentReference(
  input: EnsureDocumentReferenceInput,
): Promise<EnsureDocumentReferenceResult> {
  if (!featureFlags.unifiedAncillaryDocuments) return { status: "skipped_flag_off" };
  try {
    const resolved = await resolveOwningCase(input);
    if (resolved.kind !== "one") {
      // Ambiguous or absent — NEVER attach arbitrarily. Source-specific retry
      // keyed to the clinic we can infer only when a candidate exists.
      const clinicForRetry = input.expectedClinicId ?? null;
      const recorded = await recordReferenceRetry(input, null, clinicForRetry, `ambiguous_${resolved.kind}`);
      const warnings = [`${input.documentKind}_case_${resolved.kind}`];
      if (!recorded) warnings.push("retry_not_recorded");
      return { status: "deferred_ambiguous_case", reason: resolved.kind, retryRecorded: recorded, warnings };
    }
    const acase = resolved.case;
    // Cross-clinic guard — never attach across clinics.
    if (input.expectedClinicId != null && input.expectedClinicId !== acase.clinicId) {
      return { status: "cross_clinic_denied" };
    }
    try {
      const ref = await createReference({
        clinicId: acase.clinicId,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
        patientScreeningId: acase.originatingScreeningId ?? input.patientScreeningId ?? null,
        executionCaseId: acase.executionCaseId ?? input.executionCaseId ?? null,
        ancillaryCaseId: acase.id,
        documentKind: input.documentKind as AncillaryDocumentKind,
        sourceSystem: input.source,
        sourceTable: input.sourceTable,
        sourceId: input.sourceId,
        serviceType: input.serviceType,
        documentStatus: input.documentStatus,
        effectiveClinicalDate: input.effectiveClinicalDate ?? null,
        signedAt: input.signedAt ?? null,
        actualCreatedAt: input.actualCreatedAt ?? null,
        createdByUserId: input.actorUserId ?? null,
        metadata: {
          download_reference: input.downloadReference ?? null,
          document_kind: input.documentKind,
        },
      });
      if (ref.outcome === "created") {
        // Phase 2F Hook B: a canonical REPORT just became current for a
        // deterministically-resolved case. Awaited Procedure Note ensure
        // (flag-gated; OFF ⇒ no-op). Never blocks or reverses this reference.
        await fireProcedureNoteHookForReport(input, acase.id, acase.clinicId);
        return { status: "created", referenceId: ref.row.id, ancillaryCaseId: acase.id };
      }
      // A same-source reuse (synced-in-place or unchanged) — both resolve the
      // caller's exact-source retry; the reference row is refreshed inside
      // createReference when stale.
      if (ref.outcome === "reused_exact_source_unchanged" || ref.outcome === "reused_exact_source_updated") {
        await fireProcedureNoteHookForReport(input, acase.id, acase.clinicId);
        return { status: "reused_exact_source", referenceId: ref.existing.id, ancillaryCaseId: acase.id };
      }
      // Exact-source OWNERSHIP conflict (clinic/case) or a zero-row concurrent
      // change — never reused; record a source-specific retry and stay deferred.
      if (ref.outcome === "source_clinic_conflict" || ref.outcome === "source_case_conflict" || ref.outcome === "synchronization_conflict") {
        const rec = await recordReferenceRetry(input, acase.id, acase.clinicId, ref.outcome);
        return rec ? { status: "deferred_reference", retryRecorded: true } : { status: "retry_not_recorded", warnings: [ref.outcome, "retry_not_recorded"] };
      }
      // active_kind_conflict — a DIFFERENT source owns the current (case,kind)
      // slot. Never reused; never overwrite. Record a source-specific retry so
      // a reviewed supersession can resolve it later.
      const recorded = await recordReferenceRetry(input, acase.id, acase.clinicId, "active_document_kind_conflict");
      const warnings = ["active_document_kind_conflict"];
      if (!recorded) warnings.push("retry_not_recorded");
      return { status: "active_kind_conflict", ancillaryCaseId: acase.id, existingReferenceId: ref.existing.id, retryRecorded: recorded, warnings };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "ANCILLARY_DOCUMENT_MIGRATION_MISSING") return { status: "migration_missing" };
      const recorded = await recordReferenceRetry(input, acase.id, acase.clinicId, code ?? "reference_failed");
      return recorded ? { status: "deferred_reference", retryRecorded: true } : { status: "retry_not_recorded", warnings: ["reference_failed", "retry_not_recorded"] };
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "ANCILLARY_DOCUMENT_MIGRATION_MISSING") return { status: "migration_missing" };
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "reference_writer_threw",
      document_kind: input.documentKind, source_id: input.sourceId, code: code ?? "unknown",
    }));
    return { status: "failed" };
  }
}
