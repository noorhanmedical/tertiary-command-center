/**
 * Phase 2D-B — canonical appointment reconciliation retry worker.
 *
 * Drains `canonical_appointment_reconciliation_failures`. There is NO
 * clinic-facing repair route — this is a background-job / admin-CLI
 * entry point only.
 *
 * For `link_quick_schedule` it deterministically finds the execution
 * case, its later-linked screening, validates clinic scope, and invokes
 * finalizeQuickScheduleCanonicalLink. On success the finalize step
 * closes both the Phase 2B and Phase 2D retry rows. On failure the
 * attempt count is bumped (never cross-clinic, always PHI-free).
 *
 * `refresh_projection` re-runs the legacy projection for the recorded
 * provisional event. Other actions are re-driven where safe.
 */

import { featureFlags } from "../../lib/featureFlags";
import {
  listUnresolvedCanonicalAppointmentFailures,
  recordCanonicalAppointmentFailure,
  resolveCanonicalAppointmentFailure,
  getCanonicalAppointmentById,
} from "../../repositories/canonicalAppointments.repo";
import type { CanonicalAppointmentReconciliationFailure } from "@shared/schema/canonicalAppointments";
import { getExecutionCaseById } from "../../repositories/executionCase.repo";
import { finalizeQuickScheduleCanonicalLink } from "./quickScheduleLink";
import { refreshLegacyAppointmentProjection } from "./legacyProjection";

export type RetryOutcome = {
  failureId: number;
  requestedAction: string;
  status: "resolved" | "still_deferred" | "skipped" | "error";
  message?: string;
};

export async function retryCanonicalAppointmentFailure(
  failure: CanonicalAppointmentReconciliationFailure,
): Promise<RetryOutcome> {
  if (!featureFlags.canonicalAppointment) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped" };
  }

  try {
    switch (failure.requestedAction) {
      case "link_quick_schedule":
        return await retryLinkQuickSchedule(failure);
      case "refresh_projection":
        return await retryRefreshProjection(failure);
      default:
        // create / complete / cancel / no_show / reschedule are driven
        // by their originating request path; nothing safe to re-drive
        // blindly here without the original transition input.
        return {
          failureId: failure.id,
          requestedAction: failure.requestedAction,
          status: "skipped",
          message: "no_automatic_retry_for_action",
        };
    }
  } catch (e) {
    // Bump the attempt count (idempotent dedupe on the ledger).
    try {
      await recordCanonicalAppointmentFailure({
        clinicId: failure.clinicId,
        ancillaryCaseId: failure.ancillaryCaseId,
        patientScreeningId: failure.patientScreeningId,
        executionCaseId: failure.executionCaseId,
        provisionalEventId: failure.provisionalEventId,
        requestedAction: failure.requestedAction as never,
        sourceSystem: failure.sourceSystem ?? "retry_worker",
        errorCode: (e as { code?: string })?.code ?? "retry_failed",
      });
    } catch {
      /* ledger write guard handled downstream */
    }
    return {
      failureId: failure.id,
      requestedAction: failure.requestedAction,
      status: "error",
      message: (e as Error)?.message ?? String(e),
    };
  }
}

async function retryLinkQuickSchedule(
  failure: CanonicalAppointmentReconciliationFailure,
): Promise<RetryOutcome> {
  if (failure.executionCaseId == null) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred", message: "no_execution_case" };
  }
  const execCase = await getExecutionCaseById(failure.executionCaseId);
  if (!execCase) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred", message: "execution_case_not_found" };
  }
  // Deterministic later-screening: the screening now linked to the
  // execution case. Prefer the ledger's screening id when present.
  const screeningId = failure.patientScreeningId ?? execCase.patientScreeningId ?? null;
  if (screeningId == null) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred", message: "no_screening_yet" };
  }
  // Clinic scope: never cross clinic boundaries.
  if (execCase.clinicId != null && execCase.clinicId !== failure.clinicId) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped", message: "clinic_mismatch" };
  }

  const result = await finalizeQuickScheduleCanonicalLink({
    clinicId: failure.clinicId,
    executionCaseId: failure.executionCaseId,
    patientScreeningId: screeningId,
    provisionalEventId: failure.provisionalEventId,
    source: "retry_worker",
  });

  if (result.status === "linked" && result.perService.every((p) => p.status === "linked" || p.status === "reused")) {
    // finalize already closes the underlying rows; ensure the ledger
    // row for THIS action is resolved too.
    await resolveCanonicalAppointmentFailure({
      executionCaseId: failure.executionCaseId,
      requestedAction: "link_quick_schedule",
    });
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "resolved" };
  }
  return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred", message: result.status };
}

async function retryRefreshProjection(
  failure: CanonicalAppointmentReconciliationFailure,
): Promise<RetryOutcome> {
  if (failure.provisionalEventId == null) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped", message: "no_event" };
  }
  const evt = await getCanonicalAppointmentById(failure.provisionalEventId);
  if (!evt) {
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "skipped", message: "event_not_found" };
  }
  const projection = await refreshLegacyAppointmentProjection({ canonicalEvent: evt, source: "retry_worker" });
  if (projection.ok) {
    await resolveCanonicalAppointmentFailure({
      ancillaryCaseId: failure.ancillaryCaseId,
      requestedAction: "refresh_projection",
    });
    return { failureId: failure.id, requestedAction: failure.requestedAction, status: "resolved" };
  }
  return { failureId: failure.id, requestedAction: failure.requestedAction, status: "still_deferred" };
}

export async function retryUnresolvedCanonicalAppointmentFailures(args?: {
  clinicId?: number;
  limit?: number;
}): Promise<{ processed: number; outcomes: RetryOutcome[] }> {
  if (!featureFlags.canonicalAppointment) return { processed: 0, outcomes: [] };
  const rows = await listUnresolvedCanonicalAppointmentFailures({
    clinicId: args?.clinicId,
    limit: args?.limit ?? 100,
  });
  const outcomes: RetryOutcome[] = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await retryCanonicalAppointmentFailure(row));
  }
  return { processed: rows.length, outcomes };
}
