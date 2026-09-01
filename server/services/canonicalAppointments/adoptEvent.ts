/**
 * Phase 2D-B2 — integrity-checked adoption of an existing schedule
 * event into a canonical ancillary case.
 *
 * Replaces the raw `UPDATE global_schedule_events SET ancillary_case_id`
 * the backfill previously issued inline. Validates:
 *
 *   • event belongs to the clinic
 *   • ancillary case belongs to the clinic
 *   • event type is ancillary_appointment or same_day_add (doctor_visit
 *     refused)
 *   • service type matches the case
 *   • no conflicting ACTIVE canonical event already exists for the case
 *   • unique-index conflict handled safely (never overwrites a winner)
 *
 * Preserves the event's actual timestamps (only ancillary_case_id +
 * updated_at change), refreshes the legacy projection, and appends a
 * PHI-free audit event. Flag-gated write.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { featureFlags } from "../../lib/featureFlags";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import { getGlobalScheduleEventById } from "../../repositories/globalSchedule.repo";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import {
  getActiveCanonicalAppointmentForAncillaryCase,
  setEventAncillaryCaseIfUnset,
} from "../../repositories/canonicalAppointments.repo";
import { refreshLegacyAppointmentProjection } from "./legacyProjection";
import { CANONICAL_ANCILLARY_EVENT_TYPES } from "@shared/schema/canonicalAppointments";

const ADOPT_AUDIT_SENTINEL = "[canonical_appointment_audit]";

export type AdoptEventInput = {
  eventId: number;
  ancillaryCaseId: number;
  clinicId: number;
  serviceType: string;
  actorUserId?: string | null;
  source?: string;
};

export type AdoptEventResult =
  | { status: "skipped_flag_off" }
  | { status: "event_not_found" }
  | { status: "case_not_found" }
  | { status: "cross_clinic_denied" }
  | { status: "not_canonical_type"; eventType: string }
  | { status: "service_type_mismatch"; expected: string; got: string }
  | { status: "conflict_active_event"; conflictEventId: number }
  | { status: "already_linked"; ancillaryCaseId: number }
  | { status: "adopted"; event: GlobalScheduleEvent };

export async function adoptExistingScheduleEventAsCanonical(
  input: AdoptEventInput,
): Promise<AdoptEventResult> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  const source = input.source ?? "backfill_adopt";

  const evt = await getGlobalScheduleEventById(input.eventId);
  if (!evt) return { status: "event_not_found" };

  // doctor_visit / general events are refused outright.
  if (!(CANONICAL_ANCILLARY_EVENT_TYPES as readonly string[]).includes(evt.eventType)) {
    return { status: "not_canonical_type", eventType: evt.eventType };
  }
  if (evt.clinicId != null && evt.clinicId !== input.clinicId) {
    return { status: "cross_clinic_denied" };
  }
  // Already adopted (idempotent).
  if (evt.ancillaryCaseId != null) {
    return evt.ancillaryCaseId === input.ancillaryCaseId
      ? { status: "already_linked", ancillaryCaseId: evt.ancillaryCaseId }
      : { status: "conflict_active_event", conflictEventId: evt.id };
  }

  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  if (!acase) return { status: "case_not_found" };
  if (acase.clinicId !== input.clinicId) return { status: "cross_clinic_denied" };
  if (acase.serviceType !== input.serviceType || (evt.serviceType != null && evt.serviceType !== acase.serviceType)) {
    return { status: "service_type_mismatch", expected: acase.serviceType, got: evt.serviceType ?? input.serviceType };
  }

  // No conflicting ACTIVE canonical event may already hold the case
  // (would violate the partial-unique index once this event is
  // scheduled). If the event itself is 'scheduled', a different active
  // event blocks adoption.
  if (evt.status === "scheduled") {
    const active = await getActiveCanonicalAppointmentForAncillaryCase(input.ancillaryCaseId);
    if (active && active.id !== evt.id) {
      return { status: "conflict_active_event", conflictEventId: active.id };
    }
  }

  // Set ancillary_case_id only when unset. A unique-index conflict
  // (23505) surfaces here — resolve the winner rather than overwrite.
  let adopted: GlobalScheduleEvent | null;
  try {
    adopted = await setEventAncillaryCaseIfUnset(input.eventId, input.ancillaryCaseId);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") {
      const active = await getActiveCanonicalAppointmentForAncillaryCase(input.ancillaryCaseId);
      return { status: "conflict_active_event", conflictEventId: active?.id ?? evt.id };
    }
    throw e;
  }
  if (!adopted) {
    // Lost the race — someone linked it first.
    const reread = await getGlobalScheduleEventById(input.eventId);
    if (reread?.ancillaryCaseId === input.ancillaryCaseId) {
      return { status: "already_linked", ancillaryCaseId: input.ancillaryCaseId };
    }
    return { status: "conflict_active_event", conflictEventId: reread?.id ?? evt.id };
  }

  await refreshLegacyAppointmentProjection({ canonicalEvent: adopted, source });
  await appendAdoptAudit(adopted, source, input.actorUserId ?? null);
  return { status: "adopted", event: adopted };
}

async function appendAdoptAudit(
  evt: GlobalScheduleEvent,
  source: string,
  actorUserId: string | null,
): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: ADOPT_AUDIT_SENTINEL,
      patientDob: null,
      patientScreeningId: evt.patientScreeningId ?? null,
      executionCaseId: evt.executionCaseId ?? null,
      eventType: "canonical_appointment_event_adopted",
      eventSource: source,
      actorUserId,
      summary: "Existing schedule event adopted as canonical",
      metadata: {
        clinic_id: evt.clinicId,
        ancillary_case_id: evt.ancillaryCaseId,
        global_schedule_event_id: evt.id,
        event_type: evt.eventType,
        service_type: evt.serviceType,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn", source: "canonical_appointment_adopt", kind: "audit_write_failed",
      code: (e as { code?: string })?.code,
    }));
  }
}
