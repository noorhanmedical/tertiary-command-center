/**
 * Phase 2F — the live orchestration boundary for the canonical procedure
 * lifecycle + Procedure Note.
 *
 * Two hooks, each called AFTER its parent state change has already committed:
 *   A. onProcedureCompleted(procedureEventId) — a procedure_events row reached
 *      procedure_status='complete'. Deterministically resolves the ONE owning
 *      ancillary case, writes the additive canonical linkage onto the
 *      procedure_events row (the immutable completion evidence), then delegates
 *      to ensureCanonicalProcedureNoteForAncillaryCase.
 *   B. ensureCanonicalProcedureNoteForAncillaryCase({clinicId, ancillaryCaseId})
 *      — a canonical report became current for a case whose ancillary case is
 *      already deterministically known (the Phase 2E report writer resolved it).
 *      Delegates the two-condition eligibility to createOrReuseProcedureNote.
 *
 * Both hooks:
 *   • are gated by feature flags — OFF ⇒ zero Phase 2F reads/writes;
 *   • are idempotent (re-resolve the same case, reuse the same note);
 *   • NEVER throw — a hook failure must never reverse the already-committed
 *     procedure/report action; it records durable, PHI-free reconciliation work;
 *   • never guess an ancillary case by name / first / newest / cross-clinic.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { featureFlags } from "../../lib/featureFlags";
import { procedureEvents } from "@shared/schema/procedureEvents";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import { PROCEDURE_NOTE_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { getProcedureEventById } from "../../repositories/procedureEvents.repo";
import {
  getAncillaryCaseById,
  listAncillaryCasesForScreening,
  listAncillaryCasesForExecutionCase,
} from "../../repositories/ancillaryCases.repo";
import { recordAncillaryDocumentFailure } from "../../repositories/ancillaryDocuments.repo";
import { createOrReuseProcedureNote } from "./procedureNoteService";

const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

export type ProcedureNoteHookStatus =
  | "skipped_flag_off"
  | "not_completed"
  | "deferred_ambiguous_case"
  | "cross_clinic_denied"
  | "linked_pending_note"
  | "not_yet_eligible"
  | "created"
  | "reused"
  | "deferred_reference"
  | "reconciliation_not_recorded"
  | "migration_missing"
  | "failed";

export type ProcedureNoteHookResult = {
  status: ProcedureNoteHookStatus;
  ancillaryCaseId?: number;
  procedureNoteId?: number;
  warnings: string[];
};

// ─── Hook B — report-side / case-known ensure ─────────────────────
export type EnsureProcedureNoteInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  source: string;
};

async function recordHookRetry(
  args: { clinicId: number; ancillaryCaseId?: number | null; sourceId?: number | null },
  errorCode: string,
): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: args.clinicId,
      ancillaryCaseId: args.ancillaryCaseId ?? null,
      documentKind: "procedure_note",
      sourceTable: PROCEDURE_NOTE_SOURCE_TABLE,
      sourceId: args.sourceId ?? null,
      requestedAction: args.sourceId != null ? "link_procedure_note_evidence" : "link_procedure_note",
      sourceSystem: "procedure_lifecycle_hook",
      errorCode,
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "procedure_note_hook_retry_record_failed",
      clinic_id: args.clinicId, ancillary_case_id: args.ancillaryCaseId ?? null,
      code: (e as { code?: string })?.code ?? "ledger_write_failed",
    }));
    return false;
  }
}

export async function ensureCanonicalProcedureNoteForAncillaryCase(
  input: EnsureProcedureNoteInput,
): Promise<ProcedureNoteHookResult> {
  if (!featureFlags.canonicalProcedureNote) {
    return { status: "skipped_flag_off", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
  }
  try {
    const r = await createOrReuseProcedureNote({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
    });
    switch (r.status) {
      case "skipped_flag_off":
        return { status: "skipped_flag_off", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
      case "ineligible":
        // The two-condition boundary is not yet satisfied — truthful, not a failure.
        return { status: "not_yet_eligible", ancillaryCaseId: input.ancillaryCaseId, warnings: r.eligibility.reasons };
      case "case_not_found":
      case "cross_clinic_denied": {
        const recorded = await recordHookRetry(input, r.status);
        return {
          status: recorded ? "failed" : "reconciliation_not_recorded",
          ancillaryCaseId: input.ancillaryCaseId, warnings: [r.status],
        };
      }
      case "deferred_legacy_ambiguous":
        return { status: "deferred_ambiguous_case", ancillaryCaseId: input.ancillaryCaseId, warnings: [r.reason] };
      case "created":
      case "reused": {
        const status: ProcedureNoteHookStatus = r.referenceDeferred ? "deferred_reference" : r.status;
        return { status, procedureNoteId: r.procedureNoteId, ancillaryCaseId: input.ancillaryCaseId, warnings: r.warnings };
      }
      default: {
        const recorded = await recordHookRetry(input, "procedure_note_unexpected_status");
        return { status: recorded ? "failed" : "reconciliation_not_recorded", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
      }
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code != null && MIGRATION_MISSING_CODES.has(code)) {
      return { status: "migration_missing", ancillaryCaseId: input.ancillaryCaseId, warnings: ["migration_missing"] };
    }
    const recorded = await recordHookRetry(input, code ?? "procedure_note_hook_failed");
    return {
      status: recorded ? "failed" : "reconciliation_not_recorded",
      ancillaryCaseId: input.ancillaryCaseId, warnings: [],
    };
  }
}

// ─── Hook A — procedure-completion linkage + ensure ───────────────
/** Deterministically resolve the single active owning ancillary case for a
 *  completed procedure event — never name/first/newest. */
async function resolveOwningCase(pe: {
  executionCaseId: number | null;
  patientScreeningId: number | null;
  serviceType: string;
}): Promise<{ kind: "one"; case: PatientAncillaryCase } | { kind: "no_case" | "multiple_cases" }> {
  let candidates: PatientAncillaryCase[] = [];
  if (pe.executionCaseId != null) {
    candidates = await listAncillaryCasesForExecutionCase(pe.executionCaseId);
  } else if (pe.patientScreeningId != null) {
    candidates = await listAncillaryCasesForScreening(pe.patientScreeningId);
  } else {
    return { kind: "no_case" };
  }
  const matches = candidates.filter(
    (c) => c.serviceType === pe.serviceType && ACTIVE_LIFECYCLE.has(c.lifecycleStatus),
  );
  if (matches.length === 0) return { kind: "no_case" };
  if (matches.length > 1) return { kind: "multiple_cases" };
  return { kind: "one", case: matches[0] };
}

/**
 * Hook A. A procedure event committed as complete. Resolve its one owning
 * ancillary case, write the additive canonical linkage onto the procedure
 * event (so it belongs to exactly one case — the immutable completion
 * evidence), then delegate to the Procedure Note ensure. NEVER throws.
 */
export async function onProcedureCompleted(procedureEventId: number): Promise<ProcedureNoteHookResult> {
  if (!featureFlags.canonicalProcedureLifecycle) {
    return { status: "skipped_flag_off", warnings: [] };
  }
  try {
    const pe = await getProcedureEventById(procedureEventId);
    if (!pe || pe.procedureStatus !== "complete") {
      return { status: "not_completed", warnings: [] };
    }

    // Resolve the owning case (unless already linked deterministically).
    let acase: PatientAncillaryCase | null = null;
    if (pe.ancillaryCaseId != null) {
      acase = await getAncillaryCaseById(pe.ancillaryCaseId);
    }
    if (!acase) {
      const resolved = await resolveOwningCase(pe);
      if (resolved.kind !== "one") {
        // Ambiguous/absent — NEVER guess. Durable, source-bearing retry.
        const clinicForRetry = pe.clinicId ?? null;
        if (clinicForRetry != null) {
          await recordHookRetry({ clinicId: clinicForRetry, sourceId: procedureEventId }, `procedure_case_${resolved.kind}`);
        }
        return { status: "deferred_ambiguous_case", warnings: [`procedure_case_${resolved.kind}`] };
      }
      acase = resolved.case;
    }

    // Cross-clinic anomaly — never re-home a procedure event across clinics.
    if (pe.clinicId != null && pe.clinicId !== acase.clinicId) {
      await recordHookRetry({ clinicId: acase.clinicId, ancillaryCaseId: acase.id, sourceId: procedureEventId }, "procedure_event_cross_clinic");
      return { status: "cross_clinic_denied", ancillaryCaseId: acase.id, warnings: ["procedure_event_cross_clinic"] };
    }

    // Additive canonical linkage. Sets clinic_id when absent so the eligibility
    // read (clinic + case) resolves; never overwrites an existing clinic.
    await db
      .update(procedureEvents)
      .set({
        ancillaryCaseId: acase.id,
        clinicId: pe.clinicId ?? acase.clinicId,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(procedureEvents.id, procedureEventId));

    // Delegate the two-condition Procedure Note ensure. When the Procedure Note
    // flag is OFF this returns skipped_flag_off — the linkage is still written.
    const noteResult = await ensureCanonicalProcedureNoteForAncillaryCase({
      clinicId: acase.clinicId,
      ancillaryCaseId: acase.id,
      source: "procedure_complete_hook",
    });
    if (noteResult.status === "skipped_flag_off") {
      return { status: "linked_pending_note", ancillaryCaseId: acase.id, warnings: [] };
    }
    return noteResult;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code != null && MIGRATION_MISSING_CODES.has(code)) {
      return { status: "migration_missing", warnings: ["migration_missing"] };
    }
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "procedure_completed_hook_threw",
      procedure_event_id: procedureEventId, code: code ?? "unknown",
    }));
    return { status: "failed", warnings: [] };
  }
}
