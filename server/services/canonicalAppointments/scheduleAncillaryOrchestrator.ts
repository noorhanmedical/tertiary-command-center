/**
 * Phase 2D-B — canonical ancillary scheduling orchestrator.
 *
 * The single entry the live `schedule-ancillary` route uses when
 * FEATURE_CANONICAL_APPOINTMENT is ON. It:
 *
 *   1. resolves Phase 2A identity for the screening (reconciling on the
 *      fly when links are missing),
 *   2. reconciles the Phase 2B canonical ancillary case for the service,
 *   3. creates / reuses ONE canonical scheduled ancillary event through
 *      the domain service,
 *   4. refreshes the legacy compatibility projection,
 *   5. resolves any prior durable retry rows.
 *
 * When identity or a canonical case cannot be resolved (walk-ins, not
 * yet screened), it DEFERS: records a durable `link_quick_schedule`
 * retry and returns a truthful deferred result. It never fabricates
 * ids and never returns false success.
 *
 * Nothing here runs when the flag is OFF — the caller keeps its legacy
 * writer untouched.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../../lib/featureFlags";
import type { GlobalScheduleEvent } from "@shared/schema/globalSchedule";
import type { CanonicalAncillaryEventType } from "@shared/schema/canonicalAppointments";
import { createCanonicalAncillaryAppointment } from "./canonicalAppointmentService";
import { refreshLegacyAppointmentProjection } from "./legacyProjection";
import {
  recordCanonicalAppointmentFailure,
  resolveCanonicalAppointmentFailure,
} from "../../repositories/canonicalAppointments.repo";
import { reconcileAncillaryCaseForService } from "../ancillaryCases/reconciliation";
import { resolveAncillaryReconciliationFailure } from "../../repositories/ancillaryCases.repo";
import { reconcilePlexusIdentityForScreening } from "../plexusIdentity/reconciliation";
import { resolveCanonicalServiceType } from "@shared/canonicalService";

export type ScheduleCanonicalAncillaryInput = {
  clinicId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  serviceType: string;
  startsAt: Date;
  endsAt?: Date | null;
  eventType?: CanonicalAncillaryEventType;
  facilityId?: string | null;
  assignedUserId?: string | null;
  actorUserId?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
};

export type ScheduleCanonicalAncillaryResult =
  | { status: "skipped_flag_off" }
  | {
      status: "deferred";
      reason:
        | "no_clinic"
        | "no_screening"
        | "cross_clinic"
        | "identity_unavailable"
        | "ancillary_case_unavailable";
    }
  | { status: "error"; message: string }
  | {
      status: "created" | "reused";
      globalScheduleEventId: number;
      ancillaryCaseId: number;
      event: GlobalScheduleEvent;
      projectionDeferred: boolean;
    };

async function recordDeferral(input: ScheduleCanonicalAncillaryInput): Promise<void> {
  if (input.clinicId == null) return;
  try {
    await recordCanonicalAppointmentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: null,
      patientScreeningId: input.patientScreeningId ?? null,
      executionCaseId: input.executionCaseId ?? null,
      requestedAction: "link_quick_schedule",
      sourceSystem: input.source,
      errorCode: "DEFERRED_IDENTITY_OR_CASE_UNAVAILABLE",
    });
  } catch {
    /* flag/migration guard handled downstream */
  }
}

export async function scheduleCanonicalAncillaryAppointment(
  input: ScheduleCanonicalAncillaryInput,
): Promise<ScheduleCanonicalAncillaryResult> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  if (input.clinicId == null) return { status: "deferred", reason: "no_clinic" };

  // Canonical service identity — normalize display-name drift (e.g. "…Venous
  // Doppler" → "…Venous Duplex") to the stable registry internal_code BEFORE
  // case lookup/creation and appointment linkage, so an alias never creates a
  // separate clinical lifecycle. Explicit alias resolution only (never fuzzy);
  // an unknown string passes through unchanged. Used for every downstream write
  // (case reconcile + appointment linkage); deferral records carry no service.
  const serviceType = resolveCanonicalServiceType(input.serviceType);

  // Walk-in / not-yet-screened: no identity anchor. Defer with durable
  // retry; the quick-schedule worker links it once a screening exists.
  if (input.patientScreeningId == null) {
    await recordDeferral(input);
    return { status: "deferred", reason: "no_screening" };
  }

  // Read the screening's canonical identity state.
  let screening = await loadScreeningIdentity(input.patientScreeningId);
  if (!screening) {
    await recordDeferral(input);
    return { status: "deferred", reason: "no_screening" };
  }
  if (screening.clinicId != null && screening.clinicId !== input.clinicId) {
    return { status: "deferred", reason: "cross_clinic" };
  }

  // Resolve Phase 2A identity on the fly when missing.
  if (screening.globalPlexusPatientId == null || screening.patientClinicMembershipId == null) {
    try {
      await reconcilePlexusIdentityForScreening(input.patientScreeningId, input.clinicId);
    } catch {
      /* fall through — re-read below decides */
    }
    screening = (await loadScreeningIdentity(input.patientScreeningId)) ?? screening;
  }
  if (screening.globalPlexusPatientId == null || screening.patientClinicMembershipId == null) {
    await recordDeferral(input);
    return { status: "deferred", reason: "identity_unavailable" };
  }

  // Reconcile the canonical ancillary case for this service.
  const reconcile = await reconcileAncillaryCaseForService({
    clinicId: input.clinicId,
    globalPlexusPatientId: screening.globalPlexusPatientId,
    patientClinicMembershipId: screening.patientClinicMembershipId,
    originatingScreeningId: input.patientScreeningId,
    executionCaseId: input.executionCaseId ?? null,
    serviceType,
    source: input.source,
    actorUserId: input.actorUserId ?? null,
  });
  if (reconcile.status !== "created" && reconcile.status !== "reused") {
    await recordDeferral(input);
    return { status: "deferred", reason: "ancillary_case_unavailable" };
  }
  const ancillaryCaseId = reconcile.ancillaryCaseId;

  // Create / reuse the canonical scheduled event.
  const created = await createCanonicalAncillaryAppointment({
    clinicId: input.clinicId,
    ancillaryCaseId,
    eventType: (input.eventType ?? "ancillary_appointment") as CanonicalAncillaryEventType,
    serviceType,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    facilityId: input.facilityId ?? null,
    assignedUserId: input.assignedUserId ?? null,
    source: input.source,
    actorUserId: input.actorUserId ?? null,
    metadata: input.metadata,
  });

  if (created.status !== "created" && created.status !== "reused") {
    // service_type_mismatch / cross_clinic_denied / case_not_found /
    // skipped_flag_off — none should return false success.
    return { status: "error", message: `canonical_create_${created.status}` };
  }

  // Reflect onto legacy compatibility fields.
  const projection = await refreshLegacyAppointmentProjection({
    canonicalEvent: created.event,
    source: input.source,
  });

  // Any prior retry work for this case/service is now satisfied.
  try {
    await resolveCanonicalAppointmentFailure({ ancillaryCaseId, requestedAction: "create" });
    await resolveCanonicalAppointmentFailure({
      executionCaseId: input.executionCaseId ?? null,
      requestedAction: "link_quick_schedule",
    });
    await resolveAncillaryReconciliationFailure({
      serviceType,
      executionCaseId: input.executionCaseId ?? null,
    });
  } catch {
    /* resolution is best-effort; the event is already canonical */
  }

  return {
    status: created.status,
    globalScheduleEventId: created.event.id,
    ancillaryCaseId,
    event: created.event,
    projectionDeferred: projection.ok === false,
  };
}

async function loadScreeningIdentity(screeningId: number): Promise<{
  id: number;
  clinicId: number | null;
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
} | null> {
  const [row] = await db
    .select({
      id: patientScreenings.id,
      clinicId: patientScreenings.clinicId,
      globalPlexusPatientId: patientScreenings.globalPlexusPatientId,
      patientClinicMembershipId: patientScreenings.patientClinicMembershipId,
    })
    .from(patientScreenings)
    .where(eq(patientScreenings.id, screeningId))
    .limit(1);
  return row ?? null;
}
