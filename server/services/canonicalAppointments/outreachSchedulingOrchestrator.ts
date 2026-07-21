/**
 * Phase 2D-B — outreach + scheduling outcome orchestration boundary.
 *
 * One service boundary that records a call outcome AND (when requested)
 * drives the canonical appointment action, keeping the two consistent:
 *
 *   • records the call outcome as a PHI-free journey/audit event,
 *   • preserves Engagement workflow state (never overwrites it beyond
 *     the operationally-correct scheduling projection),
 *   • invokes the canonical appointment create/transition when a
 *     scheduling action is requested,
 *   • refreshes the legacy compatibility projection,
 *   • returns ONE truthful outcome.
 *
 * When scheduling fails, the call record is preserved, a durable
 * appointment retry is recorded, and a partial/deferred status is
 * returned — it never claims scheduling succeeded.
 *
 * No Twilio / SMS / patient messaging is introduced. All audit metadata
 * is PHI-free.
 */

import { db } from "../../db";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { featureFlags } from "../../lib/featureFlags";
import type { CanonicalAncillaryEventType } from "@shared/schema/canonicalAppointments";
import {
  createCanonicalAncillaryAppointment,
  completeCanonicalAppointment,
  cancelCanonicalAppointment,
  noShowCanonicalAppointment,
  rescheduleCanonicalAppointment,
} from "./canonicalAppointmentService";
import { refreshLegacyAppointmentProjection } from "./legacyProjection";
import { recordCanonicalAppointmentFailure } from "../../repositories/canonicalAppointments.repo";

const OUTREACH_AUDIT_SENTINEL = "[outreach_scheduling_audit]";

export type SchedulingAction =
  | "none"
  | "create"
  | "complete"
  | "cancel"
  | "no_show"
  | "reschedule";

export type OutreachSchedulingInput = {
  clinicId: number;
  executionCaseId: number | null;
  ancillaryCaseId?: number | null;
  patientScreeningId?: number | null;
  callOutcome: string;
  schedulingAction?: SchedulingAction;
  appointmentInput?: {
    eventId?: number;
    eventType?: CanonicalAncillaryEventType;
    serviceType?: string;
    startsAt?: Date;
    endsAt?: Date | null;
    newStartsAt?: Date;
    reason?: string;
  };
  actorUserId?: string | null;
  source: string;
};

export type OutreachSchedulingResult = {
  ok: boolean;
  callRecorded: boolean;
  scheduling:
    | { status: "none" }
    | { status: "skipped_flag_off" }
    | { status: "created" | "reused"; globalScheduleEventId: number }
    | { status: "completed" | "cancelled" | "no_show"; globalScheduleEventId: number }
    | { status: "rescheduled"; priorEventId: number | null; newEventId: number }
    | { status: "reason_required" }
    | { status: "invalid" | "not_found" }
    | { status: "deferred" };
  projectionDeferred?: boolean;
};

export async function recordOutreachAndSchedulingOutcome(
  input: OutreachSchedulingInput,
): Promise<OutreachSchedulingResult> {
  // Always record the call outcome (PHI-free) — this is Engagement
  // truth and must survive any scheduling failure.
  const callRecorded = await appendOutreachAudit(input, "outreach_call_outcome", {
    call_outcome: input.callOutcome,
    scheduling_action: input.schedulingAction ?? "none",
  });

  const action = input.schedulingAction ?? "none";
  if (action === "none") {
    return { ok: true, callRecorded, scheduling: { status: "none" } };
  }
  if (!featureFlags.canonicalAppointment) {
    return { ok: true, callRecorded, scheduling: { status: "skipped_flag_off" } };
  }

  try {
    const scheduling = await dispatchSchedulingAction(input, action);
    // Reflect onto legacy compatibility fields when we produced an event.
    let projectionDeferred = false;
    const evt = extractEvent(scheduling);
    if (evt) {
      const projection = await refreshLegacyAppointmentProjection({ canonicalEvent: evt.event, source: input.source });
      projectionDeferred = projection.ok === false;
    }
    const ok = isSchedulingSuccess(scheduling.status);
    return { ok, callRecorded, scheduling: scheduling.result, projectionDeferred };
  } catch (e) {
    // Preserve the call record; record durable appointment retry;
    // return deferred — NEVER claim scheduling succeeded.
    try {
      await recordCanonicalAppointmentFailure({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId ?? null,
        patientScreeningId: input.patientScreeningId ?? null,
        executionCaseId: input.executionCaseId ?? null,
        provisionalEventId: input.appointmentInput?.eventId ?? null,
        requestedAction: mapActionToFailure(action),
        sourceSystem: input.source,
        errorCode: (e as { code?: string })?.code ?? "outreach_scheduling_failed",
      });
    } catch {
      /* ledger guard downstream */
    }
    await appendOutreachAudit(input, "outreach_scheduling_deferred", {
      scheduling_action: action,
      error_code: (e as { code?: string })?.code ?? "unknown",
    });
    return { ok: false, callRecorded, scheduling: { status: "deferred" } };
  }
}

type DispatchResult = {
  status: string;
  result: OutreachSchedulingResult["scheduling"];
  event?: { event: import("@shared/schema/globalSchedule").GlobalScheduleEvent };
};

async function dispatchSchedulingAction(
  input: OutreachSchedulingInput,
  action: SchedulingAction,
): Promise<DispatchResult> {
  const appt = input.appointmentInput ?? {};
  switch (action) {
    case "create": {
      if (input.ancillaryCaseId == null || !appt.serviceType || !appt.startsAt) {
        return { status: "invalid", result: { status: "invalid" } };
      }
      const r = await createCanonicalAncillaryAppointment({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId,
        eventType: (appt.eventType ?? "ancillary_appointment") as CanonicalAncillaryEventType,
        serviceType: appt.serviceType,
        startsAt: appt.startsAt,
        endsAt: appt.endsAt ?? null,
        source: input.source,
        actorUserId: input.actorUserId ?? null,
      });
      if (r.status === "created" || r.status === "reused") {
        return { status: r.status, result: { status: r.status, globalScheduleEventId: r.event.id }, event: { event: r.event } };
      }
      return { status: "invalid", result: { status: "invalid" } };
    }
    case "complete": {
      if (appt.eventId == null) return { status: "invalid", result: { status: "invalid" } };
      const r = await completeCanonicalAppointment({ eventId: appt.eventId, clinicId: input.clinicId, source: input.source, actorUserId: input.actorUserId ?? null });
      if (r.status === "completed") return { status: "completed", result: { status: "completed", globalScheduleEventId: r.event.id }, event: { event: r.event } };
      return { status: r.status, result: mapControl(r.status) };
    }
    case "cancel": {
      if (appt.eventId == null) return { status: "invalid", result: { status: "invalid" } };
      const r = await cancelCanonicalAppointment({ eventId: appt.eventId, clinicId: input.clinicId, source: input.source, actorUserId: input.actorUserId ?? null, reason: appt.reason ?? "" });
      if (r.status === "cancelled") return { status: "cancelled", result: { status: "cancelled", globalScheduleEventId: r.event.id }, event: { event: r.event } };
      return { status: r.status, result: mapControl(r.status) };
    }
    case "no_show": {
      if (appt.eventId == null) return { status: "invalid", result: { status: "invalid" } };
      const r = await noShowCanonicalAppointment({ eventId: appt.eventId, clinicId: input.clinicId, source: input.source, actorUserId: input.actorUserId ?? null, reason: appt.reason ?? "" });
      if (r.status === "no_show") return { status: "no_show", result: { status: "no_show", globalScheduleEventId: r.event.id }, event: { event: r.event } };
      return { status: r.status, result: mapControl(r.status) };
    }
    case "reschedule": {
      if (appt.eventId == null || !appt.newStartsAt) return { status: "invalid", result: { status: "invalid" } };
      const r = await rescheduleCanonicalAppointment({ eventId: appt.eventId, clinicId: input.clinicId, source: input.source, actorUserId: input.actorUserId ?? null, newStartsAt: appt.newStartsAt, newEndsAt: appt.endsAt ?? null });
      if (r.status === "rescheduled") return { status: "rescheduled", result: { status: "rescheduled", priorEventId: r.prior?.id ?? null, newEventId: r.next.id }, event: { event: r.next } };
      return { status: r.status, result: mapControl(r.status) };
    }
    default:
      return { status: "none", result: { status: "none" } };
  }
}

function mapControl(status: string): OutreachSchedulingResult["scheduling"] {
  if (status === "reason_required") return { status: "reason_required" };
  if (status === "not_found") return { status: "not_found" };
  return { status: "invalid" };
}

function extractEvent(d: DispatchResult): { event: import("@shared/schema/globalSchedule").GlobalScheduleEvent } | null {
  return d.event ?? null;
}

function isSchedulingSuccess(status: string): boolean {
  return ["created", "reused", "completed", "cancelled", "no_show", "rescheduled"].includes(status);
}

function mapActionToFailure(action: SchedulingAction): "create" | "complete" | "cancel" | "no_show" | "reschedule" {
  return action === "none" ? "create" : action;
}

async function appendOutreachAudit(
  input: OutreachSchedulingInput,
  eventType: string,
  extra: Record<string, unknown>,
): Promise<boolean> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: OUTREACH_AUDIT_SENTINEL,
      patientDob: null,
      patientScreeningId: input.patientScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      eventType,
      eventSource: input.source,
      actorUserId: input.actorUserId ?? null,
      summary: `Outreach scheduling: ${input.callOutcome}`,
      metadata: {
        clinic_id: input.clinicId,
        ancillary_case_id: input.ancillaryCaseId ?? null,
        execution_case_id: input.executionCaseId ?? null,
        ...extra,
      },
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "outreach_scheduling",
      kind: "audit_write_failed",
      eventType,
      code: (e as { code?: string })?.code,
    }));
    return false;
  }
}
