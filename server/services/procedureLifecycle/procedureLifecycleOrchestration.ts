/**
 * Phase 2F — the live orchestration boundary for the canonical procedure
 * lifecycle + Procedure Note.
 *
 * Two hooks, each called AFTER its parent state change has already committed:
 *   A. onProcedureCompleted(procedureEventId) — a procedure_events row reached
 *      procedure_status='complete'. Deterministically resolves/validates the
 *      ONE owning ancillary case, writes the hardened additive linkage
 *      (exact-ownership scoped, affected-row-checked, never re-homed), then
 *      delegates to Hook B's ensure.
 *   B. ensureCanonicalProcedureNoteForAncillaryCase({clinicId, ancillaryCaseId})
 *      — a canonical report became current for a deterministically-known case.
 *      Delegates the two-condition eligibility to createOrReuseProcedureNote.
 *
 * Both hooks: flag-gated (OFF ⇒ zero Phase 2F reads/writes); idempotent;
 * NEVER throw (a hook failure never reverses the committed procedure/report
 * action); record truthful, PHI-free, SOURCE-CORRECT reconciliation work
 * (procedure-completion/case-link failures key on sourceTable=procedure_events,
 * sourceId=procedureEventId — never under procedure_notes). Never guess a case
 * by name / first / newest / cross-clinic.
 */

import { featureFlags } from "../../lib/featureFlags";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import {
  PROCEDURE_EVENT_SOURCE_TABLE,
} from "@shared/schema/ancillaryDocuments";
import {
  getProcedureEventById,
  linkProcedureEventToAncillaryCase,
  type ProcedureEvent,
} from "../../repositories/procedureEvents.repo";
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
  | "ownership_conflict"
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

/**
 * Record a PHI-free, SOURCE-CORRECT procedure reconciliation failure. A
 * procedure-event-bearing failure keys on (procedure_events, procedureEventId);
 * a case-level failure is source-less (sourceId null) + ancillaryCaseId. Both
 * use documentKind=procedure_note / requestedAction=link_procedure_note.
 * Returns whether the ledger row was actually persisted (never swallowed).
 */
async function recordProcedureRetry(args: {
  clinicId: number;
  ancillaryCaseId?: number | null;
  procedureEventId?: number | null;
  errorCode: string;
}): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: args.clinicId,
      ancillaryCaseId: args.ancillaryCaseId ?? null,
      documentKind: "procedure_note",
      sourceTable: PROCEDURE_EVENT_SOURCE_TABLE,
      sourceId: args.procedureEventId ?? null,
      requestedAction: "link_procedure_note",
      sourceSystem: "procedure_lifecycle_hook",
      errorCode: args.errorCode,
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

// ─── Hook B — report-side / case-known ensure ─────────────────────
export type EnsureProcedureNoteInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  source: string;
};

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
        return { status: "not_yet_eligible", ancillaryCaseId: input.ancillaryCaseId, warnings: r.eligibility.reasons };
      case "case_not_found":
      case "cross_clinic_denied": {
        const recorded = await recordProcedureRetry({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, errorCode: r.status });
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
        const recorded = await recordProcedureRetry({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, errorCode: "procedure_note_unexpected_status" });
        return { status: recorded ? "failed" : "reconciliation_not_recorded", ancillaryCaseId: input.ancillaryCaseId, warnings: [] };
      }
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code != null && MIGRATION_MISSING_CODES.has(code)) {
      return { status: "migration_missing", ancillaryCaseId: input.ancillaryCaseId, warnings: ["migration_missing"] };
    }
    const recorded = await recordProcedureRetry({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, errorCode: code ?? "procedure_note_hook_failed" });
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
  clinicId: number | null;
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
    (c) => (pe.clinicId == null || c.clinicId === pe.clinicId) &&
      c.serviceType === pe.serviceType && ACTIVE_LIFECYCLE.has(c.lifecycleStatus),
  );
  if (matches.length === 0) return { kind: "no_case" };
  if (matches.length > 1) return { kind: "multiple_cases" };
  return { kind: "one", case: matches[0] };
}

/** Validate an ALREADY-linked case against the procedure event's identity.
 *  A mismatch is an ownership conflict (never silently re-homed). */
function validateLinkedCase(pe: ProcedureEvent, c: PatientAncillaryCase | null): boolean {
  if (!c) return false;
  if (pe.clinicId != null && c.clinicId !== pe.clinicId) return false;
  if (c.serviceType !== pe.serviceType) return false;
  if (pe.executionCaseId != null && c.executionCaseId != null && c.executionCaseId !== pe.executionCaseId) return false;
  if (pe.patientScreeningId != null && c.originatingScreeningId != null && c.originatingScreeningId !== pe.patientScreeningId) return false;
  if (!ACTIVE_LIFECYCLE.has(c.lifecycleStatus)) return false;
  return true;
}

export async function onProcedureCompleted(procedureEventId: number): Promise<ProcedureNoteHookResult> {
  if (!featureFlags.canonicalProcedureLifecycle) {
    return { status: "skipped_flag_off", warnings: [] };
  }
  try {
    const pe = await getProcedureEventById(procedureEventId);
    if (!pe || pe.procedureStatus !== "complete") {
      return { status: "not_completed", warnings: [] };
    }

    let acase: PatientAncillaryCase | null = null;
    if (pe.ancillaryCaseId != null) {
      // Already linked — VALIDATE the case; a mismatch is an ownership conflict.
      acase = await getAncillaryCaseById(pe.ancillaryCaseId);
      if (!validateLinkedCase(pe, acase)) {
        await recordProcedureRetry({ clinicId: pe.clinicId ?? acase?.clinicId ?? 0, ancillaryCaseId: pe.ancillaryCaseId, procedureEventId, errorCode: "procedure_event_case_ownership_conflict" });
        return { status: "ownership_conflict", ancillaryCaseId: pe.ancillaryCaseId, warnings: ["ownership_conflict"] };
      }
    } else {
      const resolved = await resolveOwningCase(pe);
      if (resolved.kind !== "one") {
        if (pe.clinicId != null) {
          await recordProcedureRetry({ clinicId: pe.clinicId, procedureEventId, errorCode: `procedure_case_${resolved.kind}` });
        }
        return { status: "deferred_ambiguous_case", warnings: [`procedure_case_${resolved.kind}`] };
      }
      acase = resolved.case;
      // Hardened, exact-ownership linkage (affected-row checked, never re-homed).
      const link = await linkProcedureEventToAncillaryCase({
        procedureEventId, clinicId: acase.clinicId, ancillaryCaseId: acase.id,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      });
      if (link.outcome === "migration_missing") return { status: "migration_missing", ancillaryCaseId: acase.id, warnings: ["migration_missing"] };
      if (link.outcome === "ownership_conflict" || link.outcome === "zero_row_conflict") {
        await recordProcedureRetry({ clinicId: acase.clinicId, ancillaryCaseId: acase.id, procedureEventId, errorCode: link.outcome });
        return { status: link.outcome === "ownership_conflict" ? "ownership_conflict" : "deferred_ambiguous_case", ancillaryCaseId: acase.id, warnings: [link.outcome] };
      }
    }

    if (!acase) return { status: "deferred_ambiguous_case", warnings: ["no_case"] };

    // Delegate the two-condition Procedure Note ensure. Note flag OFF →
    // skipped_flag_off; the linkage is still written.
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
