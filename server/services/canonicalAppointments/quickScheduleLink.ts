/**
 * Phase 2D-B — deterministic quick-schedule canonical linkage.
 *
 * A quick-schedule (walk-in / same-day add) creates a stub execution
 * case WITHOUT Phase 2A identity and records a durable Phase 2B retry
 * row (error_code MISSING_IDENTITY_LINKS_QUICK_SCHEDULE). Once a
 * screening for that patient exists and Phase 2A identity is resolved,
 * this service deterministically materializes the canonical chain:
 *
 *   identity → Phase 2B ancillary case (per service) → canonical
 *   same_day_add event → legacy projection → close retry rows.
 *
 * Fully idempotent. Repeated runs never create duplicate global
 * patients, memberships, active cases, scheduled events, or unresolved
 * retry rows (each downstream step is reuse-first). When identity or a
 * case is unavailable it DEFERS with a durable retry and never
 * fabricates ids. Never links across clinics. PHI-free.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../../lib/featureFlags";
import { getExecutionCaseById } from "../../repositories/executionCase.repo";
import { reconcilePlexusIdentityForScreening } from "../plexusIdentity/reconciliation";
import { reconcileAncillaryCaseForService } from "../ancillaryCases/reconciliation";
import {
  listUnresolvedAncillaryReconciliationFailures,
  resolveAncillaryReconciliationFailure,
} from "../../repositories/ancillaryCases.repo";
import {
  recordCanonicalAppointmentFailure,
  resolveCanonicalAppointmentFailure,
} from "../../repositories/canonicalAppointments.repo";
import { createCanonicalAncillaryAppointment } from "./canonicalAppointmentService";
import { refreshLegacyAppointmentProjection } from "./legacyProjection";

export type FinalizeQuickScheduleInput = {
  clinicId: number;
  executionCaseId: number;
  patientScreeningId: number;
  provisionalEventId?: number | null;
  /** Optional explicit start; defaults to the execution case's next action or now. */
  startsAt?: Date;
  actorUserId?: string | null;
  source?: string;
};

export type PerServiceOutcome = {
  serviceType: string;
  status: "linked" | "reused" | "deferred" | "error";
  ancillaryCaseId?: number;
  globalScheduleEventId?: number;
  message?: string;
};

export type FinalizeQuickScheduleResult =
  | { status: "skipped_flag_off" }
  | { status: "execution_case_not_found" }
  | { status: "screening_not_found" }
  | { status: "clinic_mismatch" }
  | { status: "deferred"; reason: "identity_unavailable" | "no_services"; perService: PerServiceOutcome[] }
  | { status: "linked"; perService: PerServiceOutcome[] };

export async function finalizeQuickScheduleCanonicalLink(
  input: FinalizeQuickScheduleInput,
): Promise<FinalizeQuickScheduleResult> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  const source = input.source ?? "quick_schedule_finalize";

  // 1. Load execution case.
  const execCase = await getExecutionCaseById(input.executionCaseId);
  if (!execCase) return { status: "execution_case_not_found" };

  // 2. Load screening.
  let screening = await loadScreening(input.patientScreeningId);
  if (!screening) return { status: "screening_not_found" };

  // 3. Same-clinic guard across all three anchors.
  if (
    (execCase.clinicId != null && execCase.clinicId !== input.clinicId) ||
    (screening.clinicId != null && screening.clinicId !== input.clinicId)
  ) {
    return { status: "clinic_mismatch" };
  }

  // 4/5. Verify or run Phase 2A identity; require both links.
  if (screening.globalPlexusPatientId == null || screening.patientClinicMembershipId == null) {
    try {
      await reconcilePlexusIdentityForScreening(input.patientScreeningId, input.clinicId);
    } catch {
      /* re-read decides */
    }
    screening = (await loadScreening(input.patientScreeningId)) ?? screening;
  }
  if (screening.globalPlexusPatientId == null || screening.patientClinicMembershipId == null) {
    await recordCanonicalDeferral(input, source);
    return { status: "deferred", reason: "identity_unavailable", perService: [] };
  }

  // 6. Requested quick-schedule services: union of execution-case
  //    selectedServices + the still-open Phase 2B quick-schedule rows.
  const services = await collectRequestedServices(input.executionCaseId, execCase.selectedServices ?? null);
  if (services.length === 0) {
    return { status: "deferred", reason: "no_services", perService: [] };
  }

  const startsAt = input.startsAt ?? execCase.nextActionAt ?? new Date();
  const perService: PerServiceOutcome[] = [];

  for (const serviceType of services) {
    try {
      // 7/8. Reconcile (and associate) the canonical ancillary case.
      // eslint-disable-next-line no-await-in-loop
      const reconcile = await reconcileAncillaryCaseForService({
        clinicId: input.clinicId,
        globalPlexusPatientId: screening.globalPlexusPatientId,
        patientClinicMembershipId: screening.patientClinicMembershipId,
        originatingScreeningId: input.patientScreeningId,
        executionCaseId: input.executionCaseId,
        serviceType,
        source,
        actorUserId: input.actorUserId ?? null,
      });
      if (reconcile.status !== "created" && reconcile.status !== "reused") {
        perService.push({ serviceType, status: "deferred", message: reconcile.status });
        continue;
      }
      const ancillaryCaseId = reconcile.ancillaryCaseId;

      // 9/10. Create / reuse the canonical same_day_add event, tagging
      //        the provisional event where one exists.
      // eslint-disable-next-line no-await-in-loop
      const created = await createCanonicalAncillaryAppointment({
        clinicId: input.clinicId,
        ancillaryCaseId,
        eventType: "same_day_add",
        serviceType,
        startsAt,
        source,
        actorUserId: input.actorUserId ?? null,
        facilityId: execCase.facilityId ?? null,
        metadata: input.provisionalEventId != null
          ? { provisional_event_id: input.provisionalEventId, execution_case_id: input.executionCaseId }
          : { execution_case_id: input.executionCaseId },
      });
      if (created.status !== "created" && created.status !== "reused") {
        perService.push({ serviceType, status: "error", ancillaryCaseId, message: created.status });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await refreshLegacyAppointmentProjection({ canonicalEvent: created.event, source });

      // 11/12. Close Phase 2B + Phase 2D retry rows for this service.
      // eslint-disable-next-line no-await-in-loop
      await resolveAncillaryReconciliationFailure({
        serviceType,
        executionCaseId: input.executionCaseId,
      });
      // eslint-disable-next-line no-await-in-loop
      await resolveCanonicalAppointmentFailure({ ancillaryCaseId, requestedAction: "create" });

      perService.push({
        serviceType,
        status: created.status === "created" ? "linked" : "reused",
        ancillaryCaseId,
        globalScheduleEventId: created.event.id,
      });
    } catch (e) {
      perService.push({
        serviceType,
        status: "error",
        message: (e as Error)?.message ?? String(e),
      });
    }
  }

  // Close the execution-case-level quick-schedule retry only when every
  // service linked (no residual deferred/error work).
  const allLinked = perService.every((p) => p.status === "linked" || p.status === "reused");
  if (allLinked) {
    try {
      await resolveCanonicalAppointmentFailure({
        executionCaseId: input.executionCaseId,
        requestedAction: "link_quick_schedule",
      });
    } catch {
      /* best-effort */
    }
  }

  return { status: "linked", perService };
}

async function recordCanonicalDeferral(input: FinalizeQuickScheduleInput, source: string): Promise<void> {
  try {
    await recordCanonicalAppointmentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: null,
      patientScreeningId: input.patientScreeningId,
      executionCaseId: input.executionCaseId,
      provisionalEventId: input.provisionalEventId ?? null,
      requestedAction: "link_quick_schedule",
      sourceSystem: source,
      errorCode: "QUICK_SCHEDULE_IDENTITY_UNAVAILABLE",
    });
  } catch {
    /* flag/migration guard handled downstream */
  }
}

async function collectRequestedServices(
  executionCaseId: number,
  selectedServices: string[] | null,
): Promise<string[]> {
  const set = new Set<string>();
  for (const s of selectedServices ?? []) {
    if (s && s.trim()) set.add(s);
  }
  const openRows = await listUnresolvedAncillaryReconciliationFailures({ executionCaseId, limit: 200 });
  for (const r of openRows) {
    if (r.serviceType) set.add(r.serviceType);
  }
  return [...set];
}

async function loadScreening(screeningId: number): Promise<{
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
