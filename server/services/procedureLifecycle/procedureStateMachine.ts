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
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { featureFlags } from "../../lib/featureFlags";
import { PROCEDURE_TERMINAL_STATUSES, type ProcedureEvent } from "@shared/schema/procedureEvents";
import {
  getProcedureEventByIdForClinic,
  applyProcedureTransition,
  findCanonicalProcedureEventsByCase,
  insertCanonicalProcedureEvent,
} from "../../repositories/procedureEvents.repo";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { resolveCanonicalProcedureCaseIdentity } from "./canonicalProcedureCompletion";
import { evaluateProcedurePrerequisites, type EvaluateProcedurePrerequisitesResult } from "./procedurePrerequisites";
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
};
export type StartProcedureStatus =
  | "skipped_flag_off" | "prerequisites_blocked" | "cross_clinic_denied" | "case_not_found"
  | "case_inactive" | "service_mismatch" | "identity_mismatch" | "invalid_schedule_event"
  | "deferred_ambiguous_case" | "exact_case_required" | "procedure_event_ambiguous"
  | "invalid_transition" | "migration_missing" | "started";
export type StartProcedureResult = {
  status: StartProcedureStatus;
  procedureEvent?: ProcedureEvent;
  prerequisites?: EvaluateProcedurePrerequisitesResult;
};

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
  // Prerequisites gate (always-hard tenancy/active/appointment + configured).
  const prereq = await evaluateProcedurePrerequisites({ clinicId: input.clinicId, ancillaryCaseId: acase.id, stage: "procedure_start", actorRole: input.actorRole ?? null });
  if (prereq.migrationMissing) return { status: "migration_missing", prerequisites: prereq };
  if (!prereq.allowed) return { status: "prerequisites_blocked", prerequisites: prereq };

  try {
    const existing = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
    if (existing.length > 1) return { status: "procedure_event_ambiguous", prerequisites: prereq };
    const now = new Date();
    if (existing.length === 1) {
      const ex = existing[0];
      if (TERMINAL.has(ex.procedureStatus) || ex.procedureStatus === "paused") return { status: "invalid_transition", procedureEvent: ex, prerequisites: prereq };
      if (ex.procedureStatus === "in_progress") return { status: "started", procedureEvent: ex, prerequisites: prereq }; // idempotent
      const updated = await applyProcedureTransition(ex.id, input.clinicId, ["not_started"], { procedureStatus: "in_progress", startedAt: now });
      if (!updated) return { status: "invalid_transition", procedureEvent: ex, prerequisites: prereq };
      await appendTransitionAudit(updated, "procedure_started", input.actorUserId ?? null, { clinic_id: input.clinicId, procedure_event_id: ex.id, ancillary_case_id: acase.id, service_type: acase.serviceType });
      return { status: "started", procedureEvent: updated, prerequisites: prereq };
    }
    const created = await insertCanonicalProcedureEvent({
      clinicId: input.clinicId, ancillaryCaseId: acase.id,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null, patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      executionCaseId: acase.executionCaseId ?? input.executionCaseId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? input.patientScreeningId ?? null,
      globalScheduleEventId: resolved.qualifyingScheduleEventId ?? null, serviceType: acase.serviceType,
      completedByUserId: null, completedAt: now, note: null,
    });
    // A freshly created event begins in_progress (started), not complete.
    const started = await applyProcedureTransition(created.id, input.clinicId, ["complete", "in_progress", "not_started"], { procedureStatus: "in_progress", startedAt: now, completedAt: null });
    const row = started ?? created;
    await appendTransitionAudit(row, "procedure_started", input.actorUserId ?? null, { clinic_id: input.clinicId, procedure_event_id: created.id, ancillary_case_id: acase.id, service_type: acase.serviceType });
    return { status: "started", procedureEvent: row, prerequisites: prereq };
  } catch (e) {
    if (["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"].includes((e as { code?: string })?.code ?? "")) return { status: "migration_missing", prerequisites: prereq };
    throw e;
  }
}
