/**
 * Phase 2D-B — legacy compatibility projection.
 *
 * After a canonical ancillary appointment is created or transitioned,
 * this helper reflects that TRUTH onto the legacy compatibility fields
 * other surfaces still read:
 *
 *   • ancillary_appointments.global_schedule_event_id  (back-pointer)
 *   • patient_screenings.appointment_status / commit_status
 *   • patient_execution_cases.engagement_status / next_action_at
 *
 * Rules:
 *   • The canonical event is the SOURCE OF TRUTH. No legacy field may
 *     override it.
 *   • engagement_status remains Engagement-workflow status — we only
 *     move it to the operationally-correct scheduling value.
 *   • Projection failure NEVER masks as success: it records a durable
 *     `refresh_projection` retry and returns { ok:false, deferred:true }.
 *   • Nothing runs when FEATURE_CANONICAL_APPOINTMENT is OFF.
 *   • Never touches doctor_visit projections.
 */

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { ancillaryAppointments } from "@shared/schema/appointments";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import { featureFlags } from "../../lib/featureFlags";
import { recordCanonicalAppointmentFailure } from "../../repositories/canonicalAppointments.repo";
import { CANONICAL_ANCILLARY_EVENT_TYPES } from "@shared/schema/canonicalAppointments";

export type RefreshProjectionInput = {
  canonicalEvent: GlobalScheduleEvent;
  source: string;
};

export type RefreshProjectionResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; deferred: true; errorCode: string };

/**
 * Reflect a canonical event's status onto the legacy compatibility
 * fields. Best-effort per-field, but any thrown DB error rolls up to a
 * durable retry + truthful deferred result.
 */
export async function refreshLegacyAppointmentProjection(
  input: RefreshProjectionInput,
): Promise<RefreshProjectionResult> {
  if (!featureFlags.canonicalAppointment) return { ok: true, skipped: true };

  const evt = input.canonicalEvent;
  // Guard: only project canonical ancillary types. doctor_visit and
  // every other type are ignored — this helper never rewrites general
  // clinic-visit projections.
  if (!(CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(evt.eventType)) {
    return { ok: true, skipped: true };
  }

  try {
    // 1. Back-pointer on any legacy ancillary_appointments row for this
    //    screening + service. Never creates a row; only links existing.
    if (evt.patientScreeningId != null && evt.serviceType != null) {
      await db
        .update(ancillaryAppointments)
        .set({ globalScheduleEventId: evt.id })
        .where(
          and(
            eq(ancillaryAppointments.patientScreeningId, evt.patientScreeningId),
            eq(ancillaryAppointments.testType, evt.serviceType),
          ),
        );
    }

    // 2. Screening appointment/commit status.
    if (evt.patientScreeningId != null) {
      const screeningPatch = screeningPatchForStatus(evt.status);
      if (screeningPatch) {
        await db
          .update(patientScreenings)
          .set(screeningPatch)
          .where(eq(patientScreenings.id, evt.patientScreeningId));
      }
    }

    // 3. Execution-case engagement/next-action projection.
    if (evt.executionCaseId != null) {
      const ecPatch = executionCasePatchForStatus(evt.status, evt.startsAt);
      if (ecPatch) {
        await db
          .update(patientExecutionCases)
          .set({ ...ecPatch, updatedAt: new Date() })
          .where(eq(patientExecutionCases.id, evt.executionCaseId));
      }
    }

    return { ok: true };
  } catch (e) {
    const errorCode = (e as { code?: string })?.code ?? "projection_failed";
    // Durable retry — the canonical event already committed; the
    // projection is what lagged. Truthfully report deferred.
    try {
      if (evt.clinicId != null) {
        await recordCanonicalAppointmentFailure({
          clinicId: evt.clinicId,
          ancillaryCaseId: evt.ancillaryCaseId ?? null,
          patientScreeningId: evt.patientScreeningId ?? null,
          executionCaseId: evt.executionCaseId ?? null,
          provisionalEventId: evt.id,
          requestedAction: "refresh_projection",
          sourceSystem: input.source,
          errorCode: String(errorCode),
        });
      }
    } catch {
      /* migration/flag guard already handled downstream */
    }
    return { ok: false, deferred: true, errorCode: String(errorCode) };
  }
}

function screeningPatchForStatus(status: string): Record<string, unknown> | null {
  switch (status) {
    case "scheduled":
      return { appointmentStatus: "scheduled", commitStatus: "Scheduled" };
    case "cancelled":
      return { appointmentStatus: "cancelled" };
    case "no_show":
      return { appointmentStatus: "no_show" };
    // completed / rescheduled: do not rewrite the screening denorm.
    default:
      return null;
  }
}

function executionCasePatchForStatus(
  status: string,
  startsAt: Date | null,
): Record<string, unknown> | null {
  switch (status) {
    case "scheduled":
      return { engagementStatus: "scheduled", nextActionAt: startsAt ?? new Date() };
    case "cancelled":
      return { engagementStatus: "scheduling_needed", nextActionAt: new Date() };
    case "no_show":
      return { engagementStatus: "needs_followup", nextActionAt: new Date() };
    case "completed":
      return { engagementStatus: "contacted" };
    // rescheduled (prior event) — the new scheduled event drives the
    // projection; do nothing here.
    default:
      return null;
  }
}
