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

import { featureFlags, procedureNoteRuntimeEnabled } from "../../lib/featureFlags";
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
  | "identity_conflict"
  | "cross_clinic_denied"
  | "unscoped_event"
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
      // Source-bearing ONLY when the procedure event id is present; a case-level
      // failure is source-LESS (both NULL) — never procedure_events + null.
      sourceTable: args.procedureEventId != null ? PROCEDURE_EVENT_SOURCE_TABLE : null,
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
  // Hard, code-enforced suppression of clinical-body generation. The backfill
  // passes this so an APPLY run may create/adopt a pending note and queue exact
  // generation work WITHOUT ever invoking the generator — even when
  // FEATURE_PROCEDURE_NOTE_GENERATOR is ON. Never assumed operationally.
  suppressGeneration?: boolean;
};

export async function ensureCanonicalProcedureNoteForAncillaryCase(
  input: EnsureProcedureNoteInput,
): Promise<ProcedureNoteHookResult> {
  if (!procedureNoteRuntimeEnabled()) {
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
      case "deferred_evidence_sync":
        return { status: "deferred_reference", ancillaryCaseId: input.ancillaryCaseId, warnings: [r.reason] };
      case "amended":
        // A new pending amendment note was created — treat as reused (a current
        // note exists); generation is deferred to the generator/retry.
        return { status: "reused", procedureNoteId: r.newNoteId ?? undefined, ancillaryCaseId: input.ancillaryCaseId, warnings: ["amended"] };
      case "created":
      case "reused": {
        // Trigger the clinical-body generator when its runtime is enabled
        // (awaited, non-throwing). Default OFF ⇒ no-op; never auto-signs. A
        // caller that explicitly suppresses generation (the backfill) NEVER
        // reaches the generator, regardless of the flag.
        if (featureFlags.procedureNoteGenerator && !input.suppressGeneration && r.procedureNoteId != null) {
          try {
            const { generateProcedureNote } = await import("./procedureNoteGenerator");
            await generateProcedureNote({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, noteId: r.procedureNoteId });
          } catch { /* generator is non-blocking; its own retry ledger covers failure */ }
        }
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

export type OnProcedureCompletedInput = {
  procedureEventId: number;
  // The clinic that owns this operation (authenticated clinic / failure clinic /
  // committed event clinic). The event's clinic must equal it, or be NULL only
  // during a reviewed same-clinic linkage. NEVER manufactured as 0.
  expectedClinicId: number | null;
  // When present (event-source retry), the failure's case must match the event.
  expectedAncillaryCaseId?: number | null;
  // Code-enforced generation suppression propagated to the note ensure — the
  // backfill sets this so completion-hook linkage NEVER writes a body, even with
  // FEATURE_PROCEDURE_NOTE_GENERATOR ON.
  suppressGeneration?: boolean;
};

export async function onProcedureCompleted(input: OnProcedureCompletedInput): Promise<ProcedureNoteHookResult> {
  if (!featureFlags.canonicalProcedureLifecycle) {
    return { status: "skipped_flag_off", warnings: [] };
  }
  const { procedureEventId, expectedClinicId } = input;
  try {
    const pe = await getProcedureEventById(procedureEventId);
    if (!pe) return { status: "not_completed", warnings: ["source_not_found"] };
    if (pe.procedureStatus !== "complete") return { status: "not_completed", warnings: [] };

    // Tenant scope: the event clinic must equal the expected clinic (or be NULL
    // during a reviewed same-clinic linkage). Another clinic's event is denied.
    if (pe.clinicId != null && expectedClinicId != null && pe.clinicId !== expectedClinicId) {
      return { status: "cross_clinic_denied", warnings: ["cross_clinic_denied"] };
    }
    // The clinic we can safely act under — NEVER 0, never manufactured.
    const scopeClinicId = pe.clinicId ?? expectedClinicId ?? null;
    if (scopeClinicId == null) {
      // No valid clinic — cannot durably reconcile without manufacturing a clinic.
      return { status: "unscoped_event", ancillaryCaseId: pe.ancillaryCaseId ?? undefined, warnings: ["unscoped_event"] };
    }
    // Event-source retry: the failure's case must match the event's case.
    if (input.expectedAncillaryCaseId != null && pe.ancillaryCaseId != null && pe.ancillaryCaseId !== input.expectedAncillaryCaseId) {
      await recordProcedureRetry({ clinicId: scopeClinicId, ancillaryCaseId: pe.ancillaryCaseId, procedureEventId, errorCode: "procedure_event_case_mismatch" });
      return { status: "ownership_conflict", ancillaryCaseId: pe.ancillaryCaseId, warnings: ["case_mismatch"] };
    }

    let acase: PatientAncillaryCase | null = null;
    if (pe.ancillaryCaseId != null) {
      // Already linked — VALIDATE the case; a mismatch is an ownership conflict.
      acase = await getAncillaryCaseById(pe.ancillaryCaseId);
      if (acase == null || !validateLinkedCase(pe, acase)) {
        await recordProcedureRetry({ clinicId: scopeClinicId, ancillaryCaseId: pe.ancillaryCaseId, procedureEventId, errorCode: "procedure_event_case_ownership_conflict" });
        return { status: "ownership_conflict", ancillaryCaseId: pe.ancillaryCaseId, warnings: ["ownership_conflict"] };
      }
      // Synchronize a clinicless/underfilled same-case event (eligibility needs clinic+case).
      const sync = await linkProcedureEventToAncillaryCase({
        procedureEventId, clinicId: acase.clinicId, ancillaryCaseId: acase.id,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      });
      if (sync.outcome === "identity_conflict" || sync.outcome === "ownership_conflict") {
        await recordProcedureRetry({ clinicId: scopeClinicId, ancillaryCaseId: acase.id, procedureEventId, errorCode: sync.outcome });
        return { status: sync.outcome, ancillaryCaseId: acase.id, warnings: [sync.outcome] };
      }
    } else {
      const resolved = await resolveOwningCase({ ...pe, clinicId: scopeClinicId });
      if (resolved.kind !== "one") {
        await recordProcedureRetry({ clinicId: scopeClinicId, procedureEventId, errorCode: `procedure_case_${resolved.kind}` });
        return { status: "deferred_ambiguous_case", warnings: [`procedure_case_${resolved.kind}`] };
      }
      acase = resolved.case;
      if (input.expectedAncillaryCaseId != null && input.expectedAncillaryCaseId !== acase.id) {
        await recordProcedureRetry({ clinicId: scopeClinicId, ancillaryCaseId: acase.id, procedureEventId, errorCode: "procedure_event_case_mismatch" });
        return { status: "ownership_conflict", ancillaryCaseId: acase.id, warnings: ["case_mismatch"] };
      }
      // Hardened, exact-ownership linkage (affected-row checked, never re-homed).
      const link = await linkProcedureEventToAncillaryCase({
        procedureEventId, clinicId: acase.clinicId, ancillaryCaseId: acase.id,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      });
      if (link.outcome === "migration_missing") return { status: "migration_missing", ancillaryCaseId: acase.id, warnings: ["migration_missing"] };
      if (link.outcome === "ownership_conflict" || link.outcome === "identity_conflict" || link.outcome === "zero_row_conflict") {
        await recordProcedureRetry({ clinicId: acase.clinicId, ancillaryCaseId: acase.id, procedureEventId, errorCode: link.outcome });
        return { status: link.outcome === "zero_row_conflict" ? "deferred_ambiguous_case" : link.outcome, ancillaryCaseId: acase.id, warnings: [link.outcome] };
      }
    }

    if (!acase) return { status: "deferred_ambiguous_case", warnings: ["no_case"] };

    // Delegate the two-condition Procedure Note ensure. Full runtime gate OFF →
    // skipped_flag_off; the linkage is still written (linked, note pending runtime).
    // The backfill propagates suppressGeneration so this completion-hook route can
    // NEVER generate a body either (even with the generator flag ON).
    const noteResult = await ensureCanonicalProcedureNoteForAncillaryCase({
      clinicId: acase.clinicId,
      ancillaryCaseId: acase.id,
      source: "procedure_complete_hook",
      suppressGeneration: input.suppressGeneration,
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
