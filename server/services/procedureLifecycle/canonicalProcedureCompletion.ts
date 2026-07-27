/**
 * Phase 2F — canonical procedure completion (the ONE server-owned boundary
 * used by the completion route when FEATURE_CANONICAL_PROCEDURE_LIFECYCLE is
 * ON).
 *
 * Canonical identity is the EXACT ancillary case (never screening+service).
 * EVERY supplied identifier must agree (clinic, case, schedule event,
 * execution case, screening, service). Resolution hierarchy:
 *   1. a direct ancillaryCaseId (validated; a co-supplied globalScheduleEventId
 *      must independently agree, else the request is rejected and the schedule
 *      event is NEVER mutated);
 *   2. a globalScheduleEventId (ancillary_appointment | same_day_add only, not
 *      cancelled/no_show, its exact case; doctor_visit never valid);
 *   3. a deterministic legacy fallback (exactly one active same-clinic case).
 *
 * The result carries explicit COMMIT TRUTH: `completionCommitted` distinguishes
 * a pre-commit rejection (identity/migration/conflict — nothing written) from a
 * committed completion whose Procedure Note reconciliation was deferred. The
 * canonical completedAt is immutable. Only the VALIDATED qualifying schedule
 * event id is returned for the route to mirror.
 */

import { featureFlags } from "../../lib/featureFlags";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import {
  getAncillaryCaseById,
  listAncillaryCasesForScreening,
  listAncillaryCasesForExecutionCase,
} from "../../repositories/ancillaryCases.repo";
import { getGlobalScheduleEventById } from "../../repositories/globalSchedule.repo";
import {
  findCanonicalProcedureEventsByCase,
  insertCanonicalProcedureEvent,
  completeExistingProcedureEvent,
  linkProcedureEventToAncillaryCase,
  type ProcedureEvent,
} from "../../repositories/procedureEvents.repo";
import { upsertProcedureCompleteEvent } from "../../repositories/globalSchedule.repo";
import { upsertCaseDocumentReadinessForProcedureComplete } from "../../repositories/documentReadiness.repo";
import { evaluateBillingReadinessForProcedure } from "../../repositories/billingReadiness.repo";
import { ensureCanonicalProcedureNoteForAncillaryCase } from "./procedureLifecycleOrchestration";

const ACTIVE_LIFECYCLE = new Set(["new", "active", "on_hold"]);
const CANONICAL_EVENT_TYPES = new Set(["ancillary_appointment", "same_day_add"]);
const QUALIFYING_EVENT_STATUSES = new Set(["scheduled", "completed"]);
const PG_UNIQUE_VIOLATION = "23505";
const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

export type CompleteCanonicalProcedureInput = {
  clinicId: number;
  serviceType: string;
  ancillaryCaseId?: number | null;
  globalScheduleEventId?: number | null;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  note?: string | null;
  completedAt?: Date | null;
  completedByUserId?: string | null;
  actorUserId?: string | null;
};

export type CompletionStage =
  | "identity_resolution"
  | "procedure_event_write"
  | "derived_side_effects"
  | "procedure_note_reconciliation";

export type CompleteCanonicalProcedureStatus =
  // ── pre-commit (completionCommitted=false) ──
  | "skipped_flag_off"
  | "deferred_ambiguous_case"
  | "exact_case_required"
  | "procedure_event_ambiguous"
  | "cross_clinic_denied"
  | "service_mismatch"
  | "identity_mismatch"
  | "invalid_schedule_event"
  | "case_not_found"
  | "case_inactive"
  | "zero_row_conflict"
  | "timestamp_conflict"
  | "migration_missing"
  // ── post-commit (completionCommitted=true) ──
  | "completed_and_linked"
  | "completed_note_created"
  | "completed_note_reused"
  | "completed_waiting_for_report"
  | "completed_reconciliation_deferred"
  | "completed_reconciliation_not_recorded"
  | "completed_reconciliation_migration_missing"
  | "error";

export type CompleteCanonicalProcedureResult = {
  status: CompleteCanonicalProcedureStatus;
  completionCommitted: boolean;
  completionStage: CompletionStage;
  ancillaryCaseId?: number;
  procedureEventId?: number;
  procedureNoteId?: number;
  // Only ever the VALIDATED qualifying schedule event — never a raw, unvalidated
  // client-supplied id. The route mirrors ONLY this.
  qualifyingScheduleEventId?: number | null;
  warnings?: string[];
  reasons?: string[];
};

type ResolveResult =
  | { kind: "resolved"; case: PatientAncillaryCase; qualifyingScheduleEventId: number | null }
  | { kind: "case_not_found" }
  | { kind: "case_inactive" }
  | { kind: "cross_clinic_denied" }
  | { kind: "service_mismatch" }
  | { kind: "identity_mismatch" }
  | { kind: "invalid_schedule_event" }
  | { kind: "no_case" }
  | { kind: "exact_case_required" };

function validateCase(
  input: CompleteCanonicalProcedureInput,
  c: PatientAncillaryCase | null,
): ResolveResult | { kind: "ok"; case: PatientAncillaryCase } {
  if (!c) return { kind: "case_not_found" };
  if (c.clinicId !== input.clinicId) return { kind: "cross_clinic_denied" };
  if (c.serviceType !== input.serviceType) return { kind: "service_mismatch" };
  if (input.executionCaseId != null && c.executionCaseId != null && c.executionCaseId !== input.executionCaseId) return { kind: "identity_mismatch" };
  if (input.patientScreeningId != null && c.originatingScreeningId != null && c.originatingScreeningId !== input.patientScreeningId) return { kind: "identity_mismatch" };
  if (!ACTIVE_LIFECYCLE.has(c.lifecycleStatus)) return { kind: "case_inactive" };
  return { kind: "ok", case: c };
}

/** Validate a schedule event against the request + (optional) expected case. */
function validateScheduleEvent(
  input: CompleteCanonicalProcedureInput,
  evt: GlobalScheduleEvent | undefined,
  expectedCaseId: number | null,
): ResolveResult | { kind: "ok"; event: GlobalScheduleEvent } {
  if (!evt || !CANONICAL_EVENT_TYPES.has(evt.eventType)) return { kind: "invalid_schedule_event" };
  if (evt.clinicId != null && evt.clinicId !== input.clinicId) return { kind: "cross_clinic_denied" };
  if (evt.ancillaryCaseId == null) return { kind: "invalid_schedule_event" };
  if (expectedCaseId != null && evt.ancillaryCaseId !== expectedCaseId) return { kind: "invalid_schedule_event" };
  // Not cancelled / no_show / blocked / pending_sync / rescheduled-away.
  if (!QUALIFYING_EVENT_STATUSES.has(evt.status)) return { kind: "invalid_schedule_event" };
  if (evt.serviceType != null && evt.serviceType !== input.serviceType) return { kind: "service_mismatch" };
  if (input.executionCaseId != null && evt.executionCaseId != null && evt.executionCaseId !== input.executionCaseId) return { kind: "identity_mismatch" };
  if (input.patientScreeningId != null && evt.patientScreeningId != null && evt.patientScreeningId !== input.patientScreeningId) return { kind: "identity_mismatch" };
  return { kind: "ok", event: evt };
}

export async function resolveCanonicalProcedureCaseIdentity(
  input: CompleteCanonicalProcedureInput,
): Promise<ResolveResult> {
  // 1. Direct ancillary case — a co-supplied schedule event MUST independently agree.
  if (input.ancillaryCaseId != null) {
    const v = validateCase(input, await getAncillaryCaseById(input.ancillaryCaseId));
    if (v.kind !== "ok") return v;
    let qualifying: number | null = null;
    if (input.globalScheduleEventId != null) {
      const sv = validateScheduleEvent(input, await getGlobalScheduleEventById(input.globalScheduleEventId), v.case.id);
      if (sv.kind !== "ok") return sv;
      qualifying = sv.event.id;
    }
    return { kind: "resolved", case: v.case, qualifyingScheduleEventId: qualifying };
  }
  // 2. Canonical schedule event primary.
  if (input.globalScheduleEventId != null) {
    const sv = validateScheduleEvent(input, await getGlobalScheduleEventById(input.globalScheduleEventId), null);
    if (sv.kind !== "ok") return sv;
    const v = validateCase(input, await getAncillaryCaseById(sv.event.ancillaryCaseId as number));
    if (v.kind !== "ok") return v;
    return { kind: "resolved", case: v.case, qualifyingScheduleEventId: sv.event.id };
  }
  // 3. Deterministic legacy fallback — exactly one active same-clinic case.
  let candidates: PatientAncillaryCase[] = [];
  if (input.executionCaseId != null) {
    candidates = await listAncillaryCasesForExecutionCase(input.executionCaseId);
  } else if (input.patientScreeningId != null) {
    candidates = await listAncillaryCasesForScreening(input.patientScreeningId);
  } else {
    return { kind: "no_case" };
  }
  const matches = candidates.filter(
    (c) => c.clinicId === input.clinicId && c.serviceType === input.serviceType && ACTIVE_LIFECYCLE.has(c.lifecycleStatus),
  );
  if (matches.length === 0) return { kind: "no_case" };
  if (matches.length > 1) return { kind: "exact_case_required" };
  return { kind: "resolved", case: matches[0], qualifyingScheduleEventId: null };
}

async function runDerivedSideEffects(
  pe: ProcedureEvent,
  input: CompleteCanonicalProcedureInput,
  completedAt: Date,
): Promise<void> {
  const ctx = {
    procedureEventId: pe.id, completedAt, serviceType: input.serviceType,
    executionCaseId: input.executionCaseId ?? pe.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? pe.patientScreeningId ?? null,
    patientName: input.patientName ?? null, patientDob: input.patientDob ?? null,
    facilityId: input.facilityId ?? pe.facilityId ?? null,
  };
  try { await upsertProcedureCompleteEvent(ctx); } catch (e) { logSideEffect("badge", e); }
  try {
    await upsertCaseDocumentReadinessForProcedureComplete({
      executionCaseId: ctx.executionCaseId, patientScreeningId: ctx.patientScreeningId,
      patientName: ctx.patientName, patientDob: ctx.patientDob, facilityId: ctx.facilityId,
      serviceType: input.serviceType,
    });
  } catch (e) { logSideEffect("readiness", e); }
  try {
    await evaluateBillingReadinessForProcedure({
      executionCaseId: ctx.executionCaseId, patientScreeningId: ctx.patientScreeningId,
      procedureEventId: pe.id, patientName: ctx.patientName, patientDob: ctx.patientDob,
      facilityId: ctx.facilityId, serviceType: input.serviceType,
    });
  } catch (e) { logSideEffect("billing", e); }
}

function logSideEffect(kind: string, e: unknown): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "warn", source: "procedure_lifecycle", kind: `side_effect_${kind}_failed`, code: (e as { code?: string })?.code }));
}

function preCommit(status: CompleteCanonicalProcedureStatus, stage: CompletionStage, extra: Partial<CompleteCanonicalProcedureResult> = {}): CompleteCanonicalProcedureResult {
  return { status, completionCommitted: false, completionStage: stage, ...extra };
}

export async function completeCanonicalProcedure(
  input: CompleteCanonicalProcedureInput,
): Promise<CompleteCanonicalProcedureResult> {
  if (!featureFlags.canonicalProcedureLifecycle) return preCommit("skipped_flag_off", "identity_resolution");

  let resolved: ResolveResult;
  try {
    resolved = await resolveCanonicalProcedureCaseIdentity(input);
  } catch (e) {
    if (isMigration(e)) return preCommit("migration_missing", "identity_resolution", { reasons: ["migration_missing"] });
    throw e;
  }
  if (resolved.kind !== "resolved") {
    const map: Record<string, CompleteCanonicalProcedureStatus> = {
      case_not_found: "case_not_found", case_inactive: "case_inactive",
      cross_clinic_denied: "cross_clinic_denied", service_mismatch: "service_mismatch",
      identity_mismatch: "identity_mismatch", invalid_schedule_event: "invalid_schedule_event",
      no_case: "deferred_ambiguous_case", exact_case_required: "exact_case_required",
    };
    return preCommit(map[resolved.kind], "identity_resolution", { reasons: [resolved.kind] });
  }
  const acase = resolved.case;
  const qualifyingScheduleEventId = resolved.qualifyingScheduleEventId;
  const explicit = input.completedAt instanceof Date && !isNaN(input.completedAt.getTime());
  const completedAt = explicit ? (input.completedAt as Date) : new Date();

  // ── Stage: procedure_event_write (nothing committed until this succeeds) ──
  let event: ProcedureEvent;
  try {
    const ev = await selectOrCreateCanonicalEvent(input, acase, qualifyingScheduleEventId, completedAt, explicit);
    switch (ev.kind) {
      case "ambiguous": return preCommit("procedure_event_ambiguous", "procedure_event_write", { ancillaryCaseId: acase.id });
      case "zero_row": return preCommit("zero_row_conflict", "procedure_event_write", { ancillaryCaseId: acase.id });
      case "identity_mismatch": return preCommit("identity_mismatch", "procedure_event_write", { ancillaryCaseId: acase.id });
      case "timestamp_conflict":
        // The event IS complete (a prior commit) — truthful conflict on the
        // REQUESTED different time; nothing new committed here.
        return { status: "timestamp_conflict", completionCommitted: true, completionStage: "procedure_event_write", ancillaryCaseId: acase.id, procedureEventId: ev.event.id, qualifyingScheduleEventId, warnings: ["timestamp_conflict"] };
      case "event": event = ev.event; break;
    }
  } catch (e) {
    if (isMigration(e)) return preCommit("migration_missing", "procedure_event_write", { ancillaryCaseId: acase.id, reasons: ["migration_missing"] });
    throw e;
  }

  // ── The procedure completion is COMMITTED past this point. ──
  // Synchronize a clinicless/underfilled same-case linkage (idempotent).
  try {
    if (event.ancillaryCaseId == null || event.clinicId == null) {
      await linkProcedureEventToAncillaryCase({
        procedureEventId: event.id, clinicId: input.clinicId, ancillaryCaseId: acase.id,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      });
    }
  } catch (e) { logSideEffect("linkage", e); }

  await runDerivedSideEffects(event, input, completedAt);

  // Awaited, non-throwing Procedure Note ensure — never reverses completion.
  const note = await ensureCanonicalProcedureNoteForAncillaryCase({
    clinicId: input.clinicId, ancillaryCaseId: acase.id,
    actorUserId: input.actorUserId ?? input.completedByUserId ?? null,
    source: "procedure_complete",
  });
  return {
    ...mapNoteOutcome(note.status),
    completionCommitted: true,
    completionStage: "procedure_note_reconciliation",
    ancillaryCaseId: acase.id,
    procedureEventId: event.id,
    procedureNoteId: note.procedureNoteId,
    qualifyingScheduleEventId,
    warnings: note.warnings,
  };
}

type EventResult =
  | { kind: "event"; event: ProcedureEvent }
  | { kind: "ambiguous" }
  | { kind: "zero_row" }
  | { kind: "timestamp_conflict"; event: ProcedureEvent }
  | { kind: "identity_mismatch" };

/** Validate an existing case-scoped event is compatible before reusing it. */
function existingCompatible(ex: ProcedureEvent, input: CompleteCanonicalProcedureInput, acase: PatientAncillaryCase): boolean {
  if (ex.clinicId != null && ex.clinicId !== input.clinicId) return false;
  if (ex.ancillaryCaseId !== acase.id) return false;
  if (ex.serviceType !== input.serviceType) return false;
  if (ex.executionCaseId != null && input.executionCaseId != null && ex.executionCaseId !== input.executionCaseId) return false;
  if (ex.patientScreeningId != null && input.patientScreeningId != null && ex.patientScreeningId !== input.patientScreeningId) return false;
  return true;
}

async function selectOrCreateCanonicalEvent(
  input: CompleteCanonicalProcedureInput,
  acase: PatientAncillaryCase,
  qualifyingScheduleEventId: number | null,
  completedAt: Date,
  explicit: boolean,
): Promise<EventResult> {
  const existing = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
  if (existing.length > 1) return { kind: "ambiguous" };
  if (existing.length === 1) {
    const ex = existing[0];
    if (!existingCompatible(ex, input, acase)) return { kind: "identity_mismatch" };
    const done = await completeExistingProcedureEvent(ex, { clinicId: input.clinicId, ancillaryCaseId: acase.id, serviceType: input.serviceType }, { completedAt, explicit, completedByUserId: input.completedByUserId ?? null, note: input.note ?? null });
    switch (done.outcome) {
      case "completed":
      case "already_complete_preserved": return { kind: "event", event: done.procedureEvent };
      case "timestamp_conflict": return { kind: "timestamp_conflict", event: done.procedureEvent };
      case "zero_row_conflict": return { kind: "zero_row" };
    }
  }
  try {
    const created = await insertCanonicalProcedureEvent({
      clinicId: input.clinicId, ancillaryCaseId: acase.id,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      executionCaseId: acase.executionCaseId ?? input.executionCaseId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? input.patientScreeningId ?? null,
      globalScheduleEventId: qualifyingScheduleEventId ?? null,
      patientName: input.patientName ?? null, patientDob: input.patientDob ?? null,
      facilityId: input.facilityId ?? null, serviceType: input.serviceType,
      completedByUserId: input.completedByUserId ?? null, completedAt, note: input.note ?? null,
    });
    return { kind: "event", event: created };
  } catch (e) {
    if ((e as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
      // Concurrent insert for the SAME case — reselect the exact case winner and
      // preserve ITS completedAt (idempotent, never rewrite the winner's time).
      const again = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
      if (again.length > 1) return { kind: "ambiguous" };
      if (again.length === 1) {
        const done = await completeExistingProcedureEvent(again[0], { clinicId: input.clinicId, ancillaryCaseId: acase.id, serviceType: input.serviceType }, { completedAt, explicit, completedByUserId: input.completedByUserId ?? null, note: input.note ?? null });
        if (done.outcome === "timestamp_conflict") return { kind: "timestamp_conflict", event: done.procedureEvent };
        if (done.outcome === "zero_row_conflict") return { kind: "zero_row" };
        return { kind: "event", event: done.procedureEvent };
      }
    }
    throw e;
  }
}

function isMigration(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code != null && MIGRATION_MISSING_CODES.has(code);
}

function mapNoteOutcome(status: string): { status: CompleteCanonicalProcedureStatus } {
  switch (status) {
    case "created": return { status: "completed_note_created" };
    case "reused": return { status: "completed_note_reused" };
    case "not_yet_eligible": return { status: "completed_waiting_for_report" };
    case "deferred_ambiguous_case":
    case "deferred_reference": return { status: "completed_reconciliation_deferred" };
    case "reconciliation_not_recorded":
    case "failed":
    case "ownership_conflict":
    case "identity_conflict":
    case "cross_clinic_denied": return { status: "completed_reconciliation_not_recorded" };
    case "migration_missing": return { status: "completed_reconciliation_migration_missing" };
    // skipped_flag_off (note runtime OFF) / linked_pending_note / unscoped_event → linked.
    default: return { status: "completed_and_linked" };
  }
}
