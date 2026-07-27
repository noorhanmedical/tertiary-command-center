/**
 * Phase 2F-B — canonical procedure state machine.
 *
 * Clinic-scoped, server-owned transition commands. Every transition derives the
 * clinic from authenticated context, validates the exact ancillary case, stamps
 * server time + actor, appends a PHI-free patient_journey_event, and applies an
 * affected-row-checked update scoped by exact id + clinic + CURRENT state.
 * Invalid transitions return a conflict. Terminal rows are never reopened here.
 * Never patient-name / first / newest.
 *
 *   not_started → in_progress          (startProcedure)
 *   in_progress → paused               (pauseProcedure)
 *   paused → in_progress               (resumeProcedure)
 *   {not_started,in_progress,paused} → cancelled | no_show
 *   {in_progress,paused} → unable_to_complete
 *   {in_progress,paused} → complete    (completeCanonicalProcedure elsewhere)
 */

import { db } from "../../db";
import { and, eq, inArray } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { featureFlags } from "../../lib/featureFlags";
import { procedureEvents, PROCEDURE_TERMINAL_STATUSES, type ProcedureEvent } from "@shared/schema/procedureEvents";
import {
  getProcedureEventByIdForClinic,
  applyProcedureTransition,
  findCanonicalProcedureEventsByCase,
} from "../../repositories/procedureEvents.repo";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { resolveCanonicalProcedureCaseIdentity } from "./canonicalProcedureCompletion";
import { evaluateProcedurePrerequisites, type EvaluateProcedurePrerequisitesResult, type ProcedureOverrideRequest } from "./procedurePrerequisites";
import { voidProcedureNoteLineageForCase } from "./procedureNoteLineage";

const AUDIT_SENTINEL_NAME = "[procedure_lifecycle_audit]";
const TERMINAL = new Set<string>(PROCEDURE_TERMINAL_STATUSES as unknown as string[]);

async function appendTransitionAudit(pe: ProcedureEvent, eventType: string, actorUserId: string | null, metadata: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME, patientDob: null,
      patientScreeningId: pe.patientScreeningId ?? null, executionCaseId: pe.executionCaseId ?? null,
      eventType, eventSource: "procedure_state_machine", actorUserId,
      summary: `Procedure ${eventType} (${pe.serviceType})`, metadata,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: "warn", source: "procedure_state_machine", kind: "audit_write_failed", event_type: eventType, code: (e as { code?: string })?.code }));
  }
}

export type ProcedureTransitionStatus =
  | "skipped_flag_off" | "not_found" | "terminal_state" | "invalid_transition"
  | "transitioned";
export type ProcedureTransitionResult = { status: ProcedureTransitionStatus; procedureEvent?: ProcedureEvent };

type TransitionSpec = {
  eventType: string;
  fromStatuses: readonly string[];
  patch: (now: Date, reason?: string | null) => Record<string, unknown>;
  voidsNote?: boolean;
};

async function runTransition(
  id: number, clinicId: number, actorUserId: string | null, reason: string | null, spec: TransitionSpec,
): Promise<ProcedureTransitionResult> {
  if (!featureFlags.canonicalProcedureLifecycle) return { status: "skipped_flag_off" };
  const pe = await getProcedureEventByIdForClinic(id, clinicId);
  if (!pe) return { status: "not_found" };
  if (TERMINAL.has(pe.procedureStatus)) return { status: "terminal_state", procedureEvent: pe };
  if (!spec.fromStatuses.includes(pe.procedureStatus)) return { status: "invalid_transition", procedureEvent: pe };
  const now = new Date();
  const updated = await applyProcedureTransition(id, clinicId, spec.fromStatuses, spec.patch(now, reason));
  if (!updated) return { status: "invalid_transition", procedureEvent: pe };
  await appendTransitionAudit(updated, spec.eventType, actorUserId, { clinic_id: clinicId, procedure_event_id: id, ancillary_case_id: updated.ancillaryCaseId ?? null, service_type: updated.serviceType, new_status: updated.procedureStatus });
  // A procedure leaving an active state → reconcile (void) its current note lineage.
  if (spec.voidsNote && updated.ancillaryCaseId != null && updated.clinicId != null) {
    await voidProcedureNoteLineageForCase({ clinicId: updated.clinicId, ancillaryCaseId: updated.ancillaryCaseId, reason: spec.eventType, actorUserId });
  }
  return { status: "transitioned", procedureEvent: updated };
}

export const pauseProcedure = (id: number, clinicId: number, actorUserId: string | null) =>
  runTransition(id, clinicId, actorUserId, null, { eventType: "procedure_paused", fromStatuses: ["in_progress"], patch: (now) => ({ procedureStatus: "paused", pausedAt: now }) });

export const resumeProcedure = (id: number, clinicId: number, actorUserId: string | null) =>
  runTransition(id, clinicId, actorUserId, null, { eventType: "procedure_resumed", fromStatuses: ["paused"], patch: (now) => ({ procedureStatus: "in_progress", resumedAt: now }) });

export const cancelProcedure = (id: number, clinicId: number, reason: string | null, actorUserId: string | null) =>
  runTransition(id, clinicId, actorUserId, reason, { eventType: "procedure_cancelled", fromStatuses: ["not_started", "in_progress", "paused"], voidsNote: true, patch: (now, r) => ({ procedureStatus: "cancelled", cancelledAt: now, cancellationReason: r ?? null }) });

export const markProcedureNoShow = (id: number, clinicId: number, reason: string | null, actorUserId: string | null) =>
  runTransition(id, clinicId, actorUserId, reason, { eventType: "procedure_no_show", fromStatuses: ["not_started", "in_progress", "paused"], voidsNote: true, patch: (now) => ({ procedureStatus: "no_show", noShowAt: now }) });

export const markProcedureUnableToComplete = (id: number, clinicId: number, reason: string | null, actorUserId: string | null) =>
  runTransition(id, clinicId, actorUserId, reason, { eventType: "procedure_unable_to_complete", fromStatuses: ["in_progress", "paused"], voidsNote: true, patch: (now, r) => ({ procedureStatus: "unable_to_complete", unableToCompleteAt: now, unableToCompleteReason: r ?? null }) });

// ─── start (resolves/creates the canonical event; prerequisite-gated) ───────
export type StartProcedureInput = {
  clinicId: number; serviceType: string;
  ancillaryCaseId?: number | null; globalScheduleEventId?: number | null;
  executionCaseId?: number | null; patientScreeningId?: number | null;
  actorUserId?: string | null; actorRole?: string | null;
  override?: ProcedureOverrideRequest | null;
};
export type StartProcedureStatus =
  | "skipped_flag_off" | "prerequisites_blocked" | "cross_clinic_denied" | "case_not_found"
  | "case_inactive" | "service_mismatch" | "identity_mismatch" | "invalid_schedule_event"
  | "deferred_ambiguous_case" | "exact_case_required" | "procedure_event_ambiguous"
  | "invalid_transition" | "override_audit_failed" | "migration_missing" | "started";
export type StartProcedureResult = {
  status: StartProcedureStatus;
  procedureEvent?: ProcedureEvent;
  prerequisites?: EvaluateProcedurePrerequisitesResult;
};

const PG_UNIQUE_VIOLATION = "23505";

export async function startProcedure(input: StartProcedureInput): Promise<StartProcedureResult> {
  if (!featureFlags.canonicalProcedureLifecycle) return { status: "skipped_flag_off" };
  const resolved = await resolveCanonicalProcedureCaseIdentity(input);
  if (resolved.kind !== "resolved") {
    const map: Record<string, StartProcedureStatus> = {
      case_not_found: "case_not_found", case_inactive: "case_inactive", cross_clinic_denied: "cross_clinic_denied",
      service_mismatch: "service_mismatch", identity_mismatch: "identity_mismatch", invalid_schedule_event: "invalid_schedule_event",
      no_case: "deferred_ambiguous_case", exact_case_required: "exact_case_required",
    };
    return { status: map[resolved.kind] };
  }
  const acase = resolved.case;
  const prereq = await evaluateProcedurePrerequisites({ clinicId: input.clinicId, ancillaryCaseId: acase.id, stage: "procedure_start", actorRole: input.actorRole ?? null, override: input.override ?? null });
  if (prereq.migrationMissing) return { status: "migration_missing", prerequisites: prereq };
  if (!prereq.allowed) return { status: "prerequisites_blocked", prerequisites: prereq };

  // Any applied override MUST be audited transactionally with the start write —
  // if the required audit fails, the start rolls back (remains blocked/deferred).
  const auditMeta = { clinic_id: input.clinicId, ancillary_case_id: acase.id, service_type: acase.serviceType };
  const writeOverrideAudits = async (tx: Pick<typeof db, "insert">) => {
    for (const ov of prereq.appliedOverrides) {
      await tx.insert(patientJourneyEvents).values({
        patientName: AUDIT_SENTINEL_NAME, patientDob: null,
        patientScreeningId: acase.originatingScreeningId ?? null, executionCaseId: acase.executionCaseId ?? null,
        eventType: "procedure_prerequisite_override", eventSource: "procedure_state_machine", actorUserId: input.actorUserId ?? null,
        summary: `Prerequisite override applied (${acase.serviceType})`,
        metadata: { ...auditMeta, requirement_code: ov.requirementCode, actor_role: input.actorRole ?? null, reason: input.override?.reason ?? null },
      });
    }
  };

  try {
    const existing = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
    if (existing.length > 1) return { status: "procedure_event_ambiguous", prerequisites: prereq };
    const now = new Date();

    if (existing.length === 1) {
      const ex = existing[0];
      if (TERMINAL.has(ex.procedureStatus) || ex.procedureStatus === "paused") return { status: "invalid_transition", procedureEvent: ex, prerequisites: prereq };
      if (ex.procedureStatus === "in_progress") return { status: "started", procedureEvent: ex, prerequisites: prereq }; // idempotent
      // not_started → in_progress + override audits, atomically.
      try {
        const row = await db.transaction(async (tx) => {
          const rows = await tx.update(procedureEvents)
            .set({ procedureStatus: "in_progress", startedAt: now, lastTransitionAt: now, updatedAt: now })
            .where(and(eq(procedureEvents.id, ex.id), eq(procedureEvents.clinicId, input.clinicId), inArray(procedureEvents.procedureStatus, ["not_started"]))).returning();
          if (rows.length !== 1) throw new StartTxError("transition");
          await writeOverrideAudits(tx);
          return rows[0];
        });
        await appendTransitionAudit(row, "procedure_started", input.actorUserId ?? null, { ...auditMeta, procedure_event_id: ex.id });
        return { status: "started", procedureEvent: row, prerequisites: prereq };
      } catch (te) {
        if (te instanceof StartTxError && te.kind === "transition") return { status: "invalid_transition", procedureEvent: ex, prerequisites: prereq };
        return { status: "override_audit_failed", prerequisites: prereq };
      }
    }

    // No existing event → a SINGLE in_progress insert (never a completed row) +
    // override audits in one transaction. Concurrent start → reselect winner.
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx.insert(procedureEvents).values({
          clinicId: input.clinicId, ancillaryCaseId: acase.id,
          globalPlexusPatientId: acase.globalPlexusPatientId ?? null, patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
          executionCaseId: acase.executionCaseId ?? input.executionCaseId ?? null,
          patientScreeningId: acase.originatingScreeningId ?? input.patientScreeningId ?? null,
          globalScheduleEventId: resolved.qualifyingScheduleEventId ?? null, serviceType: acase.serviceType,
          procedureStatus: "in_progress", startedAt: now, lastTransitionAt: now, completedAt: null, completedByUserId: null, note: null,
        }).returning();
        try { await writeOverrideAudits(tx); } catch { throw new StartTxError("audit"); }
        return row;
      });
      await appendTransitionAudit(created, "procedure_started", input.actorUserId ?? null, { ...auditMeta, procedure_event_id: created.id });
      return { status: "started", procedureEvent: created, prerequisites: prereq };
    } catch (ie) {
      // A required override-audit failure rolled the start back — remain deferred.
      if (ie instanceof StartTxError) return { status: "override_audit_failed", prerequisites: prereq };
      if ((ie as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        // Concurrent start for the SAME case — converge on the exact winner.
        const again = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
        if (again.length === 1) {
          const w = again[0];
          if (w.procedureStatus === "in_progress") return { status: "started", procedureEvent: w, prerequisites: prereq };
          return { status: "invalid_transition", procedureEvent: w, prerequisites: prereq };
        }
        if (again.length > 1) return { status: "procedure_event_ambiguous", prerequisites: prereq };
      }
      throw ie;
    }
  } catch (e) {
    if (["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"].includes((e as { code?: string })?.code ?? "")) return { status: "migration_missing", prerequisites: prereq };
    throw e;
  }
}

class StartTxError extends Error { constructor(public kind: "transition" | "audit") { super(kind); } }
