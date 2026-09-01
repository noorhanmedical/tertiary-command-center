/**
 * Phase 2D-B3 — call-result → canonical scheduling bridge.
 *
 * Shared by the Engagement Center and Plexus Task call-outcome routes.
 * When FEATURE_CANONICAL_APPOINTMENT is ON it records the outcome
 * through recordOutreachAndSchedulingOutcome and maps the canonical
 * result onto a truthful HTTP status:
 *
 *   200 — recorded; no scheduling requested, or scheduling completed
 *   202 — recorded; scheduling deferred (retryPending)
 *   409 — required scheduling input missing / invalid transition
 *   503 — canonical schema/configuration unavailable
 *
 * It NEVER fabricates ancillaryCaseId, appointment time, cancel reason,
 * or no-show reason: a scheduling action is attempted only when the
 * caller supplied the real inputs, otherwise it returns 409.
 *
 * `schedulingAction: "none"` records a PHI-free audit and returns
 * `{ handled: false }` so the caller continues its legacy workflow
 * writes (which are Engagement/task state, never appointment truth).
 */

import { featureFlags } from "../../lib/featureFlags";
import {
  recordOutreachAndSchedulingOutcome,
  type SchedulingAction,
} from "./outreachSchedulingOrchestrator";

export type CallResultSchedulingInput = {
  clinicId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  ancillaryCaseId?: number | null;
  callOutcome: string;
  schedulingAction: SchedulingAction;
  appointmentInput?: {
    eventId?: number;
    serviceType?: string;
    startsAt?: Date;
    endsAt?: Date | null;
    newStartsAt?: Date;
    reason?: string;
  };
  actorUserId?: string | null;
  source: string;
};

export type CallResultSchedulingOutcome =
  | { handled: false; recordedAudit: boolean }
  | { handled: true; http: 200 | 202 | 409 | 503; body: Record<string, unknown> };

function refuse(error: string): CallResultSchedulingOutcome {
  return { handled: true, http: 409, body: { error, code: "CANONICAL_ANCILLARY_CASE_REQUIRED" } };
}

export async function runCallResultScheduling(
  input: CallResultSchedulingInput,
): Promise<CallResultSchedulingOutcome> {
  if (!featureFlags.canonicalAppointment) return { handled: false, recordedAudit: false };

  const action = input.schedulingAction;

  // Non-scheduling outcome: record a PHI-free audit, then let the caller
  // proceed with its legacy workflow writes.
  if (action === "none") {
    const r = await recordOutreachAndSchedulingOutcome({
      clinicId: input.clinicId ?? 0,
      executionCaseId: input.executionCaseId,
      patientScreeningId: input.patientScreeningId,
      ancillaryCaseId: input.ancillaryCaseId ?? null,
      callOutcome: input.callOutcome,
      schedulingAction: "none",
      actorUserId: input.actorUserId ?? null,
      source: input.source,
    });
    return { handled: false, recordedAudit: r.callRecorded };
  }

  // A real scheduling action requires real inputs — never fabricated.
  if (input.clinicId == null) return refuse("clinic scope is required for a scheduling action");
  const appt = input.appointmentInput ?? {};
  if (action === "create") {
    if (input.ancillaryCaseId == null || !appt.serviceType || !appt.startsAt) {
      return refuse("create requires ancillaryCaseId, serviceType and startsAt");
    }
  } else {
    if (appt.eventId == null) return refuse("globalScheduleEventId is required for this transition");
    if (action === "cancel" && !appt.reason?.trim()) return refuse("cancellation reason is required");
    if (action === "no_show" && !appt.reason?.trim()) return refuse("no-show reason is required");
    if (action === "reschedule" && (!appt.newStartsAt || Number.isNaN(appt.newStartsAt.getTime()))) {
      return refuse("reschedule requires newStartsAt");
    }
  }

  try {
    const r = await recordOutreachAndSchedulingOutcome({
      clinicId: input.clinicId,
      executionCaseId: input.executionCaseId,
      patientScreeningId: input.patientScreeningId,
      ancillaryCaseId: input.ancillaryCaseId ?? null,
      callOutcome: input.callOutcome,
      schedulingAction: action,
      appointmentInput: appt,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
    });
    const s = r.scheduling.status;
    if (s === "deferred") {
      return { handled: true, http: 202, body: { ok: true, callRecorded: r.callRecorded, retryPending: true, scheduling: r.scheduling } };
    }
    if (s === "reason_required") return refuse("a reason is required for this transition");
    if (s === "invalid" || s === "not_found") {
      return { handled: true, http: 409, body: { error: "invalid scheduling transition", code: "CANONICAL_INVALID_TRANSITION", scheduling: r.scheduling } };
    }
    // created / reused / completed / cancelled / no_show / rescheduled / none
    return { handled: true, http: 200, body: { ok: r.ok, callRecorded: r.callRecorded, scheduling: r.scheduling, projectionDeferred: r.projectionDeferred ?? false } };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703" || code === "CANONICAL_APPOINTMENT_MIGRATION_MISSING") {
      return { handled: true, http: 503, body: { error: "canonical appointment schema unavailable — apply migration 0052", code: "CANONICAL_APPOINTMENT_MIGRATION_MISSING" } };
    }
    throw e;
  }
}

/** Map an Engagement Center callResult to a canonical scheduling action. */
export function engagementActionForOutcome(callResult: string): SchedulingAction {
  switch (callResult) {
    case "cancelled":
      return "cancel";
    case "no_show":
      return "no_show";
    case "reschedule":
    case "needs_new_date":
      return "reschedule";
    default:
      return "none";
  }
}

/** Map a Plexus Task appointmentStatus to a canonical scheduling action. */
export function plexusActionForAppointmentStatus(appointmentStatus: string | undefined): SchedulingAction {
  switch (appointmentStatus) {
    case "cancelled":
      return "cancel";
    case "no_show":
      return "no_show";
    case "completed":
      return "complete";
    default:
      return "none";
  }
}
