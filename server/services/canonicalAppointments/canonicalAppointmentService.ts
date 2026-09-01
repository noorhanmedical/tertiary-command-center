/**
 * Phase 2D — canonical ancillary appointment domain service.
 *
 * One entry point for every ancillary appointment write. Enforces:
 *   • Event type in {ancillary_appointment, same_day_add} (doctor_visit
 *     is refused).
 *   • Ancillary case exists + belongs to the caller's clinic.
 *   • Screening/execution-case linkage matches clinic when supplied.
 *   • Service type matches the ancillary case's service_type.
 *   • Repeat call for the same case's active event returns the
 *     existing row (idempotent).
 *   • Race conflict → re-read the winning row.
 *   • Non-PHI journey events for every outcome.
 *   • Durable retry on failure.
 *
 * Nothing here writes when FEATURE_CANONICAL_APPOINTMENT is OFF.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { patientScreenings } from "@shared/schema/screening";
import { patientExecutionCases, patientJourneyEvents } from "@shared/schema/executionCase";
import {
  CANONICAL_ANCILLARY_EVENT_TYPES,
  CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES,
  ORDER_NOTE_QUALIFYING_STATUSES,
  type CanonicalAncillaryEventType,
  type CanonicalAppointmentStatus,
} from "@shared/schema/canonicalAppointments";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import { featureFlags } from "../../lib/featureFlags";
import {
  createCanonicalEvent,
  getActiveCanonicalAppointmentForAncillaryCase,
  getCanonicalAppointmentById,
  listCanonicalAppointmentsForAncillaryCase,
  recordCanonicalAppointmentFailure,
  rescheduleCanonicalEvent,
  resolveCanonicalAppointmentFailure,
  transitionCanonicalEvent,
} from "../../repositories/canonicalAppointments.repo";
import { ensureCanonicalOrderNoteForAncillaryCase } from "../ancillaryDocuments/orderNoteOrchestration";

const AUDIT_SENTINEL_NAME = "[canonical_appointment_audit]";

/**
 * Phase 2E-B — after a qualifying ancillary appointment becomes available
 * (scheduled or completed), attempt canonical Order Note create/reuse. This
 * is ONE side of the two-condition eligibility boundary (the other is Admin
 * Review approval). Eligibility is decided inside the Order Note service; a
 * pending review simply yields not_yet_eligible here. NEVER throws — a hook
 * failure records durable retry and must not reverse the committed
 * appointment transaction. Reschedule/cancel/no_show do NOT call this.
 */
async function fireOrderNoteAppointmentHook(args: {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  source: string;
}): Promise<void> {
  if (!featureFlags.canonicalOrderNote) return;
  try {
    const r = await ensureCanonicalOrderNoteForAncillaryCase({
      clinicId: args.clinicId,
      ancillaryCaseId: args.ancillaryCaseId,
      actorUserId: args.actorUserId ?? null,
      source: `${args.source}:appointment`,
    });
    if (r.status === "failed" || r.status === "reconciliation_not_recorded" || r.status === "migration_missing") {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "warn", source: "canonical_appointment", kind: "order_note_hook",
        status: r.status, clinic_id: args.clinicId, ancillary_case_id: args.ancillaryCaseId,
      }));
    }
  } catch (e) {
    // Defence in depth — ensure...() already catches, but the parent
    // transaction must never be reversed by this hook under any circumstance.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error", source: "canonical_appointment", kind: "order_note_hook_threw",
      clinic_id: args.clinicId, ancillary_case_id: args.ancillaryCaseId,
      code: (e as { code?: string })?.code ?? "unknown",
    }));
  }
}

export type CreateAppointmentInput = {
  clinicId: number;
  ancillaryCaseId: number;
  eventType: CanonicalAncillaryEventType;
  // Caller's asserted service type. When supplied it MUST match the
  // ancillary case's service_type (the source of truth); a mismatch is
  // refused. When omitted the case's service_type is used verbatim.
  serviceType?: string;
  startsAt: Date;
  endsAt?: Date | null;
  facilityId?: string | null;
  assignedUserId?: string | null;
  assignedRole?: string | null;
  roomId?: string | null;
  equipmentId?: string | null;
  source: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateAppointmentResult =
  | { status: "skipped_flag_off" }
  | { status: "invalid_event_type"; eventType: string }
  | { status: "case_not_found"; ancillaryCaseId: number }
  | { status: "cross_clinic_denied"; ancillaryCaseId: number }
  | { status: "service_type_mismatch"; expected: string; got: string }
  | {
      status: "reused";
      event: GlobalScheduleEvent;
    }
  | {
      status: "created";
      event: GlobalScheduleEvent;
    };

async function appendJourneyEvent(args: {
  eventType: string;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  summary: string;
  source: string;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME,
      patientDob: null,
      patientScreeningId: args.patientScreeningId,
      executionCaseId: args.executionCaseId,
      eventType: args.eventType,
      eventSource: args.source,
      actorUserId: args.actorUserId,
      summary: args.summary,
      metadata: args.metadata,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "canonical_appointment",
      kind: "journey_event_write_failed",
      eventType: args.eventType,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

/**
 * The one Send-to-Schedule entry point. Idempotent within an
 * ancillary case: repeat calls for a case that already has an active
 * scheduled event return `{ status: "reused", event }`.
 */
export async function createCanonicalAncillaryAppointment(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  if (!featureFlags.canonicalAppointment) {
    return { status: "skipped_flag_off" };
  }
  if (!(CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    // doctor_visit + everything else refused. This is a hard business
    // rule — the domain service is for ancillary appointments only.
    return { status: "invalid_event_type", eventType: input.eventType };
  }

  // Load ancillary case + tenant check.
  const [acase] = await db
    .select()
    .from(patientAncillaryCases)
    .where(eq(patientAncillaryCases.id, input.ancillaryCaseId))
    .limit(1);
  if (!acase) return { status: "case_not_found", ancillaryCaseId: input.ancillaryCaseId };
  if (acase.clinicId !== input.clinicId) {
    return { status: "cross_clinic_denied", ancillaryCaseId: input.ancillaryCaseId };
  }

  // Screening + execution case linkage sanity (when known).
  let patientScreeningId: number | null = acase.originatingScreeningId ?? null;
  let executionCaseId: number | null = acase.executionCaseId ?? null;
  if (patientScreeningId != null) {
    const [scr] = await db
      .select({ id: patientScreenings.id, clinicId: patientScreenings.clinicId, name: patientScreenings.name, dob: patientScreenings.dob, facility: patientScreenings.facility })
      .from(patientScreenings)
      .where(eq(patientScreenings.id, patientScreeningId))
      .limit(1);
    if (scr && scr.clinicId != null && scr.clinicId !== input.clinicId) {
      return { status: "cross_clinic_denied", ancillaryCaseId: input.ancillaryCaseId };
    }
  }
  if (executionCaseId != null) {
    const [ec] = await db
      .select({ id: patientExecutionCases.id, clinicId: patientExecutionCases.clinicId })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, executionCaseId))
      .limit(1);
    if (ec && ec.clinicId != null && ec.clinicId !== input.clinicId) {
      return { status: "cross_clinic_denied", ancillaryCaseId: input.ancillaryCaseId };
    }
  }

  const serviceType = acase.serviceType;
  // Service-type validation: the caller's asserted service type must
  // match the ancillary case's service_type when supplied.
  if (input.serviceType != null && input.serviceType !== serviceType) {
    return {
      status: "service_type_mismatch",
      expected: serviceType,
      got: input.serviceType,
    };
  }

  // Idempotent reuse-check.
  const existing = await getActiveCanonicalAppointmentForAncillaryCase(input.ancillaryCaseId);
  if (existing) {
    await appendJourneyEvent({
      eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.reused,
      patientScreeningId,
      executionCaseId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        clinic_id: input.clinicId,
        ancillary_case_id: input.ancillaryCaseId,
        global_schedule_event_id: existing.id,
        event_type: existing.eventType,
        service_type: serviceType,
        source: input.source,
      },
      summary: `Canonical ancillary appointment reused (${serviceType})`,
      source: input.source,
    });
    await fireOrderNoteAppointmentHook({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, actorUserId: input.actorUserId ?? null, source: input.source });
    return { status: "reused", event: existing };
  }

  // Insert. Race-safe via the repo (partial-unique index).
  try {
    const outcome = await createCanonicalEvent({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      eventType: input.eventType,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      serviceType,
      patientScreeningId,
      executionCaseId,
      facilityId: input.facilityId ?? null,
      assignedUserId: input.assignedUserId ?? null,
      assignedRole: input.assignedRole ?? null,
      roomId: input.roomId ?? null,
      equipmentId: input.equipmentId ?? null,
      source: input.source,
      metadata: input.metadata,
    });
    if (outcome.created) {
      await appendJourneyEvent({
        eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.created,
        patientScreeningId,
        executionCaseId,
        actorUserId: input.actorUserId ?? null,
        metadata: {
          clinic_id: input.clinicId,
          ancillary_case_id: input.ancillaryCaseId,
          global_schedule_event_id: outcome.row.id,
          event_type: outcome.row.eventType,
          service_type: serviceType,
          source: input.source,
        },
        summary: `Canonical ancillary appointment created (${serviceType})`,
        source: input.source,
      });
      // Any prior retry row for `create` on this case is now stale.
      await resolveCanonicalAppointmentFailure({
        ancillaryCaseId: input.ancillaryCaseId,
        requestedAction: "create",
      });
      await fireOrderNoteAppointmentHook({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, actorUserId: input.actorUserId ?? null, source: input.source });
      return { status: "created", event: outcome.row };
    }
    await appendJourneyEvent({
      eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.reused,
      patientScreeningId,
      executionCaseId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        race_conflict: true,
        clinic_id: input.clinicId,
        ancillary_case_id: input.ancillaryCaseId,
        global_schedule_event_id: outcome.conflict.id,
      },
      summary: `Canonical ancillary appointment reused (race conflict, ${serviceType})`,
      source: input.source,
    });
    await fireOrderNoteAppointmentHook({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, actorUserId: input.actorUserId ?? null, source: input.source });
    return { status: "reused", event: outcome.conflict };
  } catch (e) {
    // Durable retry — do NOT silently swallow.
    try {
      await recordCanonicalAppointmentFailure({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId,
        patientScreeningId,
        executionCaseId,
        requestedAction: "create",
        sourceSystem: input.source,
        errorCode: (e as { code?: string })?.code ?? "unknown",
      });
    } catch { /* migration guard already handled */ }
    await appendJourneyEvent({
      eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.reconciliationFailed,
      patientScreeningId,
      executionCaseId,
      actorUserId: input.actorUserId ?? null,
      metadata: {
        clinic_id: input.clinicId,
        ancillary_case_id: input.ancillaryCaseId,
        requested_action: "create",
        error_code: (e as { code?: string })?.code ?? "unknown",
      },
      summary: `Canonical appointment create failed (${serviceType})`,
      source: input.source,
    });
    throw e;
  }
}

// ─── Transitions ─────────────────────────────────────────────────
export type TransitionInput = {
  eventId: number;
  clinicId: number;
  source: string;
  actorUserId?: string | null;
};

export type CancelInput = TransitionInput & { reason: string };
export type NoShowInput = TransitionInput & { reason: string };
export type RescheduleInput = TransitionInput & {
  newStartsAt: Date;
  newEndsAt?: Date | null;
};

async function loadCanonicalEventForTenant(
  eventId: number,
  clinicId: number,
): Promise<GlobalScheduleEvent | null> {
  const row = await getCanonicalAppointmentById(eventId);
  if (!row) return null;
  if (row.clinicId != null && row.clinicId !== clinicId) return null;
  return row;
}

export async function completeCanonicalAppointment(input: TransitionInput): Promise<
  | { status: "skipped_flag_off" }
  | { status: "not_found" | "cross_clinic_denied" | "invalid_transition" }
  | { status: "completed"; event: GlobalScheduleEvent }
> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  const evt = await loadCanonicalEventForTenant(input.eventId, input.clinicId);
  if (!evt) return { status: "not_found" };
  if (evt.status !== "scheduled") return { status: "invalid_transition" };
  const updated = await transitionCanonicalEvent(evt.id, { status: "completed" });
  if (!updated) return { status: "not_found" };
  await appendJourneyEvent({
    eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.completed,
    patientScreeningId: evt.patientScreeningId ?? null,
    executionCaseId: evt.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: {
      clinic_id: evt.clinicId,
      ancillary_case_id: evt.ancillaryCaseId,
      global_schedule_event_id: evt.id,
      previous_status: "scheduled",
      new_status: "completed",
      source: input.source,
    },
    summary: `Canonical appointment completed`,
    source: input.source,
  });
  // Completed ancillary_appointment / same_day_add is a qualifying event too.
  if (evt.ancillaryCaseId != null && evt.clinicId != null) {
    await fireOrderNoteAppointmentHook({ clinicId: evt.clinicId, ancillaryCaseId: evt.ancillaryCaseId, actorUserId: input.actorUserId ?? null, source: input.source });
  }
  return { status: "completed", event: updated };
}

export async function cancelCanonicalAppointment(input: CancelInput): Promise<
  | { status: "skipped_flag_off" }
  | { status: "not_found" | "cross_clinic_denied" | "invalid_transition" | "reason_required" }
  | { status: "cancelled"; event: GlobalScheduleEvent }
> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  if (!input.reason || !input.reason.trim()) return { status: "reason_required" };
  const evt = await loadCanonicalEventForTenant(input.eventId, input.clinicId);
  if (!evt) return { status: "not_found" };
  if (evt.status !== "scheduled") return { status: "invalid_transition" };
  const updated = await transitionCanonicalEvent(evt.id, {
    status: "cancelled",
    cancellationReason: input.reason,
  });
  if (!updated) return { status: "not_found" };
  await appendJourneyEvent({
    eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.cancelled,
    patientScreeningId: evt.patientScreeningId ?? null,
    executionCaseId: evt.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: {
      clinic_id: evt.clinicId,
      ancillary_case_id: evt.ancillaryCaseId,
      global_schedule_event_id: evt.id,
      previous_status: "scheduled",
      new_status: "cancelled",
      reason_code: "cancellation",
      source: input.source,
    },
    summary: `Canonical appointment cancelled`,
    source: input.source,
  });
  return { status: "cancelled", event: updated };
}

export async function noShowCanonicalAppointment(input: NoShowInput): Promise<
  | { status: "skipped_flag_off" }
  | { status: "not_found" | "invalid_transition" | "reason_required" }
  | { status: "no_show"; event: GlobalScheduleEvent }
> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  if (!input.reason || !input.reason.trim()) return { status: "reason_required" };
  const evt = await loadCanonicalEventForTenant(input.eventId, input.clinicId);
  if (!evt) return { status: "not_found" };
  if (evt.status !== "scheduled") return { status: "invalid_transition" };
  const updated = await transitionCanonicalEvent(evt.id, {
    status: "no_show",
    noShowReason: input.reason,
  });
  if (!updated) return { status: "not_found" };
  await appendJourneyEvent({
    eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.noShow,
    patientScreeningId: evt.patientScreeningId ?? null,
    executionCaseId: evt.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: {
      clinic_id: evt.clinicId,
      ancillary_case_id: evt.ancillaryCaseId,
      global_schedule_event_id: evt.id,
      previous_status: "scheduled",
      new_status: "no_show",
      reason_code: "no_show",
      source: input.source,
    },
    summary: `Canonical appointment no-show`,
    source: input.source,
  });
  return { status: "no_show", event: updated };
}

/**
 * Reschedule contract: mark prior 'rescheduled' + insert new
 * scheduled event with parent_event_id linkage. Prior event is
 * preserved permanently.
 */
export async function rescheduleCanonicalAppointment(input: RescheduleInput): Promise<
  | { status: "skipped_flag_off" }
  | { status: "not_found" | "cross_clinic_denied" | "invalid_transition" }
  | { status: "rescheduled"; prior: GlobalScheduleEvent | null; next: GlobalScheduleEvent }
> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  const evt = await loadCanonicalEventForTenant(input.eventId, input.clinicId);
  if (!evt) return { status: "not_found" };
  if (evt.status !== "scheduled") return { status: "invalid_transition" };
  if (evt.ancillaryCaseId == null || evt.serviceType == null) {
    return { status: "invalid_transition" };
  }
  const outcome = await rescheduleCanonicalEvent({
    priorEventId: evt.id,
    input: {
      clinicId: evt.clinicId as number,
      ancillaryCaseId: evt.ancillaryCaseId,
      eventType: (evt.eventType as CanonicalAncillaryEventType),
      startsAt: input.newStartsAt,
      endsAt: input.newEndsAt ?? null,
      serviceType: evt.serviceType,
      patientScreeningId: evt.patientScreeningId ?? null,
      executionCaseId: evt.executionCaseId ?? null,
      patientName: evt.patientName ?? null,
      patientDob: evt.patientDob ?? null,
      facilityId: evt.facilityId ?? null,
      source: input.source,
    },
  });
  const nextEvent = outcome.next.created ? outcome.next.row : outcome.next.conflict;
  await appendJourneyEvent({
    eventType: CANONICAL_APPOINTMENT_JOURNEY_EVENT_TYPES.rescheduled,
    patientScreeningId: evt.patientScreeningId ?? null,
    executionCaseId: evt.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: {
      clinic_id: evt.clinicId,
      ancillary_case_id: evt.ancillaryCaseId,
      global_schedule_event_id: nextEvent.id,
      parent_event_id: evt.id,
      previous_status: "scheduled",
      new_status: "scheduled",
      source: input.source,
    },
    summary: `Canonical appointment rescheduled`,
    source: input.source,
  });
  return { status: "rescheduled", prior: outcome.prior, next: nextEvent };
}

// ─── Order Note appointment eligibility ─────────────────────────
export type OrderNoteEligibilityInput = {
  ancillaryCaseId: number;
};

export type OrderNoteEligibilityResult =
  | { eligible: true; event: GlobalScheduleEvent; status: CanonicalAppointmentStatus }
  | { eligible: false; reason: OrderNoteIneligibleReason };

export type OrderNoteIneligibleReason =
  | "flag_off"
  | "no_matching_event"
  | "event_status_not_qualifying"
  | "event_type_not_canonical"
  | "service_type_mismatch";

/**
 * Phase 2E consumer contract:
 *
 *   appointment eligibility is satisfied only when the ancillary
 *   case has a canonical event with matching service_type where:
 *     • event_type IN (ancillary_appointment, same_day_add)
 *     • status IN (scheduled, completed)
 *
 *   doctor_visit NEVER qualifies. Cancelled / no_show / rescheduled
 *   (historical prior) events NEVER qualify.
 *
 * Full Order Note eligibility (also requires Admin Review approved)
 * lives in Phase 2E. This helper is the appointment-only building
 * block.
 */
export async function isOrderNoteAppointmentEligible(
  input: OrderNoteEligibilityInput,
): Promise<OrderNoteEligibilityResult> {
  if (!featureFlags.canonicalAppointment) {
    return { eligible: false, reason: "flag_off" };
  }
  const [ac] = await db
    .select({ id: patientAncillaryCases.id, serviceType: patientAncillaryCases.serviceType })
    .from(patientAncillaryCases)
    .where(eq(patientAncillaryCases.id, input.ancillaryCaseId))
    .limit(1);
  if (!ac) return { eligible: false, reason: "no_matching_event" };

  const events = await listCanonicalAppointmentsForAncillaryCase(input.ancillaryCaseId);
  // Scan for a qualifying event. The partial-unique index guarantees
  // at most one active-scheduled event; completed events are
  // permanent — one case may have any number over time. First match
  // wins by preferring 'scheduled' over 'completed'.
  const scheduled = events.find(
    (e) =>
      (CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(e.eventType) &&
      e.status === "scheduled" &&
      e.serviceType === ac.serviceType,
  );
  if (scheduled) return { eligible: true, event: scheduled, status: "scheduled" };
  const completed = events.find(
    (e) =>
      (CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(e.eventType) &&
      e.status === "completed" &&
      e.serviceType === ac.serviceType,
  );
  if (completed) return { eligible: true, event: completed, status: "completed" };

  // Diagnose why:
  const anyCanonical = events.find((e) =>
    (CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(e.eventType),
  );
  if (!anyCanonical) return { eligible: false, reason: "event_type_not_canonical" };
  const anyMatchingService = events.find(
    (e) => e.serviceType === ac.serviceType,
  );
  if (!anyMatchingService) return { eligible: false, reason: "service_type_mismatch" };
  return { eligible: false, reason: "event_status_not_qualifying" };
}

// Re-export the qualifying-status set for consumer convenience.
export { ORDER_NOTE_QUALIFYING_STATUSES };
