/**
 * Phase 2F — canonical procedure completion (the ONE server-owned boundary
 * used by the completion route when FEATURE_CANONICAL_PROCEDURE_LIFECYCLE is
 * ON).
 *
 * Canonical identity is the EXACT ancillary case (never screening+service,
 * which collides across episodes). Resolution hierarchy:
 *   1. a direct ancillaryCaseId (validated: clinic, service, exec/screening,
 *      active lifecycle);
 *   2. a globalScheduleEventId (ancillary_appointment | same_day_add only, its
 *      exact ancillaryCaseId; doctor_visit never valid);
 *   3. a deterministic legacy fallback (exactly one active same-clinic case for
 *      exec|screening + exact service).
 *
 * Dedupe/reselect is by ancillaryCaseId, so two same-service episodes create
 * two separate procedure-event rows and no event is ever re-homed. Ambiguity is
 * surfaced truthfully (exact_case_required / procedure_event_ambiguous), never
 * hidden by first/newest selection. The completion is committed first; the
 * awaited, non-throwing Procedure Note ensure never reverses it.
 */

import { and, eq } from "drizzle-orm";
import { featureFlags } from "../../lib/featureFlags";
import type { PatientAncillaryCase } from "@shared/schema/ancillaryCases";
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

export type CompleteCanonicalProcedureStatus =
  | "skipped_flag_off"
  | "completed_and_linked"
  | "completed_note_created"
  | "completed_note_reused"
  | "completed_waiting_for_report"
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
  | "reconciliation_not_recorded"
  | "migration_missing"
  | "error";

export type CompleteCanonicalProcedureResult = {
  status: CompleteCanonicalProcedureStatus;
  ancillaryCaseId?: number;
  procedureEventId?: number;
  procedureNoteId?: number;
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

/** Validate a candidate case against the authenticated clinic + supplied identity. */
function validateCase(
  input: CompleteCanonicalProcedureInput,
  c: PatientAncillaryCase | null,
): ResolveResult | { kind: "ok"; case: PatientAncillaryCase } {
  if (!c) return { kind: "case_not_found" };
  if (c.clinicId !== input.clinicId) return { kind: "cross_clinic_denied" };
  if (c.serviceType !== input.serviceType) return { kind: "service_mismatch" };
  if (input.executionCaseId != null && c.executionCaseId != null && c.executionCaseId !== input.executionCaseId) {
    return { kind: "identity_mismatch" };
  }
  if (input.patientScreeningId != null && c.originatingScreeningId != null && c.originatingScreeningId !== input.patientScreeningId) {
    return { kind: "identity_mismatch" };
  }
  if (!ACTIVE_LIFECYCLE.has(c.lifecycleStatus)) return { kind: "case_inactive" };
  return { kind: "ok", case: c };
}

export async function resolveCanonicalProcedureCaseIdentity(
  input: CompleteCanonicalProcedureInput,
): Promise<ResolveResult> {
  // 1. Direct ancillary case.
  if (input.ancillaryCaseId != null) {
    const v = validateCase(input, await getAncillaryCaseById(input.ancillaryCaseId));
    return v.kind === "ok" ? { kind: "resolved", case: v.case, qualifyingScheduleEventId: null } : v;
  }
  // 2. Canonical schedule event (never doctor_visit).
  if (input.globalScheduleEventId != null) {
    const evt = await getGlobalScheduleEventById(input.globalScheduleEventId);
    if (!evt || !CANONICAL_EVENT_TYPES.has(evt.eventType)) return { kind: "invalid_schedule_event" };
    if (evt.clinicId != null && evt.clinicId !== input.clinicId) return { kind: "cross_clinic_denied" };
    if (evt.ancillaryCaseId == null) return { kind: "invalid_schedule_event" };
    if (evt.serviceType != null && evt.serviceType !== input.serviceType) return { kind: "service_mismatch" };
    const v = validateCase(input, await getAncillaryCaseById(evt.ancillaryCaseId));
    return v.kind === "ok" ? { kind: "resolved", case: v.case, qualifyingScheduleEventId: evt.id } : v;
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

/** Derived/mirror side effects — awaited, individually non-throwing so a mirror
 *  failure never reverses the committed completion. Billing readiness is
 *  preserved (Phase 2F alters note truth only, not billing behavior). */
async function runDerivedSideEffects(
  pe: ProcedureEvent,
  input: CompleteCanonicalProcedureInput,
  completedAt: Date,
): Promise<void> {
  const ctx = {
    procedureEventId: pe.id,
    completedAt,
    serviceType: input.serviceType,
    executionCaseId: input.executionCaseId ?? pe.executionCaseId ?? null,
    patientScreeningId: input.patientScreeningId ?? pe.patientScreeningId ?? null,
    patientName: input.patientName ?? null,
    patientDob: input.patientDob ?? null,
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

export async function completeCanonicalProcedure(
  input: CompleteCanonicalProcedureInput,
): Promise<CompleteCanonicalProcedureResult> {
  if (!featureFlags.canonicalProcedureLifecycle) return { status: "skipped_flag_off" };

  const resolved = await resolveCanonicalProcedureCaseIdentity(input);
  if (resolved.kind !== "resolved") {
    const map: Record<string, CompleteCanonicalProcedureStatus> = {
      case_not_found: "case_not_found", case_inactive: "case_inactive",
      cross_clinic_denied: "cross_clinic_denied", service_mismatch: "service_mismatch",
      identity_mismatch: "identity_mismatch", invalid_schedule_event: "invalid_schedule_event",
      no_case: "deferred_ambiguous_case", exact_case_required: "exact_case_required",
    };
    return { status: map[resolved.kind], reasons: [resolved.kind] };
  }
  const acase = resolved.case;
  const completedAt = input.completedAt instanceof Date && !isNaN(input.completedAt.getTime()) ? input.completedAt : new Date();

  try {
    // Dedupe/reselect by ancillary case (never screening+service).
    let pe = await selectOrCreateCanonicalEvent(input, acase, resolved.qualifyingScheduleEventId, completedAt);
    if ("ambiguous" in pe) return { status: "procedure_event_ambiguous", ancillaryCaseId: acase.id };
    if ("conflict" in pe) return { status: "zero_row_conflict", ancillaryCaseId: acase.id };
    const event = pe.event;

    // Ensure the ownership linkage is present + hardened (idempotent).
    if (event.ancillaryCaseId == null) {
      await linkProcedureEventToAncillaryCase({
        procedureEventId: event.id, clinicId: input.clinicId, ancillaryCaseId: acase.id,
        globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
        patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      });
    }

    await runDerivedSideEffects(event, input, completedAt);

    // Awaited, non-throwing Procedure Note ensure — never reverses completion.
    const note = await ensureCanonicalProcedureNoteForAncillaryCase({
      clinicId: input.clinicId, ancillaryCaseId: acase.id,
      actorUserId: input.actorUserId ?? input.completedByUserId ?? null,
      source: "procedure_complete",
    });
    return { ...mapNoteOutcome(note.status), ancillaryCaseId: acase.id, procedureEventId: event.id, procedureNoteId: note.procedureNoteId };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code != null && MIGRATION_MISSING_CODES.has(code)) return { status: "migration_missing", ancillaryCaseId: acase.id };
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: "error", source: "procedure_lifecycle", kind: "canonical_completion_threw", ancillary_case_id: acase.id, code: code ?? "unknown" }));
    return { status: "error", ancillaryCaseId: acase.id };
  }
}

async function selectOrCreateCanonicalEvent(
  input: CompleteCanonicalProcedureInput,
  acase: PatientAncillaryCase,
  qualifyingScheduleEventId: number | null,
  completedAt: Date,
): Promise<{ event: ProcedureEvent } | { ambiguous: true } | { conflict: true }> {
  const existing = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
  if (existing.length > 1) return { ambiguous: true };
  if (existing.length === 1) {
    const done = await completeExistingProcedureEvent(existing[0].id, input.clinicId, {
      completedAt, completedByUserId: input.completedByUserId ?? null, note: input.note ?? null,
    });
    return done ? { event: done } : { conflict: true };
  }
  try {
    const created = await insertCanonicalProcedureEvent({
      clinicId: input.clinicId, ancillaryCaseId: acase.id,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      executionCaseId: acase.executionCaseId ?? input.executionCaseId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? input.patientScreeningId ?? null,
      globalScheduleEventId: qualifyingScheduleEventId ?? input.globalScheduleEventId ?? null,
      patientName: input.patientName ?? null, patientDob: input.patientDob ?? null,
      facilityId: input.facilityId ?? null, serviceType: input.serviceType,
      completedByUserId: input.completedByUserId ?? null, completedAt, note: input.note ?? null,
    });
    return { event: created };
  } catch (e) {
    if ((e as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
      // Concurrent insert for the SAME case — reselect the exact case winner.
      const again = await findCanonicalProcedureEventsByCase(input.clinicId, acase.id);
      if (again.length > 1) return { ambiguous: true };
      if (again.length === 1) {
        const done = await completeExistingProcedureEvent(again[0].id, input.clinicId, {
          completedAt, completedByUserId: input.completedByUserId ?? null, note: input.note ?? null,
        });
        return done ? { event: done } : { conflict: true };
      }
    }
    throw e;
  }
}

function mapNoteOutcome(status: string): { status: CompleteCanonicalProcedureStatus } {
  switch (status) {
    case "created": return { status: "completed_note_created" };
    case "reused": return { status: "completed_note_reused" };
    case "not_yet_eligible": return { status: "completed_waiting_for_report" };
    case "deferred_ambiguous_case": return { status: "deferred_ambiguous_case" };
    case "reconciliation_not_recorded":
    case "deferred_reference":
    case "failed":
    case "cross_clinic_denied": return { status: "reconciliation_not_recorded" };
    case "migration_missing": return { status: "migration_missing" };
    // skipped_flag_off (note flag OFF) / linked_pending_note → completed + linked.
    default: return { status: "completed_and_linked" };
  }
}
