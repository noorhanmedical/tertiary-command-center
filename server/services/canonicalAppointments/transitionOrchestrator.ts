/**
 * Phase 2D-B — ancillary transition routing.
 *
 * Decides whether a global_schedule_events transition should be driven
 * by the canonical domain service (FEATURE_CANONICAL_APPOINTMENT ON AND
 * the event is a canonical ancillary type) or left to the legacy
 * `applyScheduleTransition` writer.
 *
 * When it handles the transition, cancel/no_show require a nonblank
 * reason (→ 400), invalid transitions return a controlled 409, and the
 * legacy compatibility projection is refreshed after success. When it
 * does not handle it (flag OFF, or doctor_visit / non-canonical event),
 * it returns { handled: false } and the caller keeps legacy behavior
 * exactly.
 */

import { featureFlags } from "../../lib/featureFlags";
import { getGlobalScheduleEventById } from "../../repositories/globalSchedule.repo";
import { CANONICAL_ANCILLARY_EVENT_TYPES } from "@shared/schema/canonicalAppointments";
import {
  completeCanonicalAppointment,
  cancelCanonicalAppointment,
  noShowCanonicalAppointment,
  rescheduleCanonicalAppointment,
} from "./canonicalAppointmentService";
import { refreshLegacyAppointmentProjection } from "./legacyProjection";

export type AncillaryTransition = "cancel" | "reschedule" | "no_show" | "complete";

export type CanonicalTransitionInput = {
  eventId: number;
  transition: AncillaryTransition | "confirm";
  clinicId: number | null;
  reason?: string | null;
  newStartsAt?: Date | null;
  newEndsAt?: Date | null;
  actorUserId?: string | null;
  source: string;
};

export type CanonicalTransitionResult =
  | { handled: false }
  | { handled: true; ok: true; status: 200; body: Record<string, unknown> }
  | { handled: true; ok: false; status: 400 | 404 | 409; error: string };

export async function applyCanonicalAncillaryTransition(
  input: CanonicalTransitionInput,
): Promise<CanonicalTransitionResult> {
  if (!featureFlags.canonicalAppointment) return { handled: false };
  // confirm has no canonical status — leave it on the legacy path.
  if (input.transition === "confirm") return { handled: false };

  const evt = await getGlobalScheduleEventById(input.eventId);
  if (!evt) return { handled: false }; // let legacy return its own 404
  if (!(CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(evt.eventType)) {
    return { handled: false }; // doctor_visit / general → legacy
  }

  const clinicId = input.clinicId ?? evt.clinicId ?? null;
  if (clinicId == null) return { handled: false };

  switch (input.transition) {
    case "complete": {
      const r = await completeCanonicalAppointment({ eventId: input.eventId, clinicId, source: input.source, actorUserId: input.actorUserId ?? null });
      if (r.status === "completed") return await success(r.event, input.source, { event: r.event, newStatus: "completed" });
      return controlError(r.status);
    }
    case "cancel": {
      if (!input.reason || !input.reason.trim()) {
        return { handled: true, ok: false, status: 400, error: "cancellation reason is required" };
      }
      const r = await cancelCanonicalAppointment({ eventId: input.eventId, clinicId, source: input.source, actorUserId: input.actorUserId ?? null, reason: input.reason });
      if (r.status === "cancelled") return await success(r.event, input.source, { event: r.event, newStatus: "cancelled" });
      return controlError(r.status);
    }
    case "no_show": {
      if (!input.reason || !input.reason.trim()) {
        return { handled: true, ok: false, status: 400, error: "no-show reason is required" };
      }
      const r = await noShowCanonicalAppointment({ eventId: input.eventId, clinicId, source: input.source, actorUserId: input.actorUserId ?? null, reason: input.reason });
      if (r.status === "no_show") return await success(r.event, input.source, { event: r.event, newStatus: "no_show" });
      return controlError(r.status);
    }
    case "reschedule": {
      if (!input.newStartsAt || Number.isNaN(input.newStartsAt.getTime())) {
        return { handled: true, ok: false, status: 400, error: "reschedule requires newStartsAt" };
      }
      const r = await rescheduleCanonicalAppointment({ eventId: input.eventId, clinicId, source: input.source, actorUserId: input.actorUserId ?? null, newStartsAt: input.newStartsAt, newEndsAt: input.newEndsAt ?? null });
      if (r.status === "rescheduled") {
        await refreshLegacyAppointmentProjection({ canonicalEvent: r.next, source: input.source });
        return {
          handled: true,
          ok: true,
          status: 200,
          body: {
            ok: true,
            transition: "reschedule",
            priorEventId: r.prior?.id ?? null,
            newEventId: r.next.id,
            parentEventId: r.next.parentEventId ?? null,
            event: r.next,
          },
        };
      }
      return controlError(r.status);
    }
    default:
      return { handled: false };
  }
}

async function success(
  event: import("@shared/schema/globalSchedule").GlobalScheduleEvent,
  source: string,
  body: Record<string, unknown>,
): Promise<CanonicalTransitionResult> {
  await refreshLegacyAppointmentProjection({ canonicalEvent: event, source });
  return { handled: true, ok: true, status: 200, body: { ok: true, ...body } };
}

function controlError(status: string): CanonicalTransitionResult {
  if (status === "not_found") return { handled: true, ok: false, status: 404, error: "Schedule event not found" };
  if (status === "reason_required") return { handled: true, ok: false, status: 400, error: "reason is required" };
  // invalid_transition / cross_clinic_denied / skipped_flag_off
  return { handled: true, ok: false, status: 409, error: `Cannot apply transition (${status})` };
}
