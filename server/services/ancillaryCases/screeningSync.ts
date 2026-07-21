/**
 * Phase 2B (hardened) — shared reconciliation of a screening's
 * qualifyingTests into canonical ancillary cases. Used by:
 *
 *   • executionCase.repo.createOrUpdateExecutionCaseFromScreening
 *     (the commit path — reads the returned projection to overwrite
 *     patient_execution_cases.selectedServices)
 *   • The three admin-review regeneration services
 *     (adminReviewRegenerateAllService, adminReviewRegenerateAncillaryService,
 *     adminReviewRegenerateTestService) — they persist qualifyingTests
 *     but do NOT own an execution case; the returned projection is
 *     ignored by these callers (a subsequent commit will re-project
 *     into selectedServices).
 *
 * Behavior contract (SAME as the wrapper inside executionCase.repo):
 *
 *   FEATURE_ANCILLARY_CASE_WRITE = OFF → zero DB touches; projection: null.
 *   ON + identity missing → durable retry rows recorded; projection: null;
 *                            deferred: true; missingIdentityLinks: true.
 *   ON + identity present → reconcile bulk; failures durable-recorded;
 *                            intentionally removed services (defined-list
 *                            only, EXCLUDING failed-reconcile entries)
 *                            → conservative on_hold; projection returned.
 */

import type { PatientScreening } from "@shared/schema/screening";
import {
  reconcileAncillaryCasesBulk,
  conservativelyRemoveAncillaryService,
  projectSelectedServicesFromAncillaryCases,
  type ReconcileInput,
} from "./reconciliation";
import {
  listAncillaryCasesForPatient,
  recordAncillaryReconciliationFailure,
} from "../../repositories/ancillaryCases.repo";
import { featureFlags } from "../../lib/featureFlags";
import type {
  AncillaryAdminReviewStatus,
  AncillaryQualificationStatus,
} from "@shared/schema/ancillaryCases";

export type ScreeningAncillarySyncInput = {
  screening: PatientScreening;
  executionCaseId: number | null;
  actorUserId: string | null;
  /** The DEFINED requested list. If the caller does not know
   *  intentionality (e.g. an update didn't touch qualifyingTests),
   *  omit `requestedServicesDefined: false` — no on_hold pass will
   *  run. */
  requestedServices: string[];
  requestedServicesDefined: boolean;
  source: string;
};

export type ScreeningAncillarySyncResult = {
  projection: string[] | null;
  deferred: boolean;
  missingIdentityLinks: boolean;
  reconciledCount: number;
  retryCount: number;
};

export async function syncScreeningAncillaryCases(
  args: ScreeningAncillarySyncInput,
): Promise<ScreeningAncillarySyncResult> {
  const { screening, executionCaseId, actorUserId, requestedServices, requestedServicesDefined, source } = args;

  if (!featureFlags.ancillaryCaseWrite) {
    return { projection: null, deferred: false, missingIdentityLinks: false, reconciledCount: 0, retryCount: 0 };
  }

  const clinicId = screening.clinicId ?? null;
  const globalPlexusPatientId = (screening as { globalPlexusPatientId?: number | null }).globalPlexusPatientId ?? null;
  const patientClinicMembershipId = (screening as { patientClinicMembershipId?: number | null }).patientClinicMembershipId ?? null;

  if (!clinicId || !globalPlexusPatientId || !patientClinicMembershipId) {
    if (requestedServicesDefined && clinicId && requestedServices.length > 0) {
      for (const serviceType of requestedServices) {
        try {
          await recordAncillaryReconciliationFailure({
            patientScreeningId: screening.id,
            executionCaseId,
            clinicId,
            globalPlexusPatientId,
            patientClinicMembershipId,
            serviceType,
            requestedAction: "ensure_active",
            sourceSystem: source,
            errorCode: "MISSING_IDENTITY_LINKS",
          });
        } catch {
          // Migration missing → repo threw ANCILLARY_CASE_MIGRATION_MISSING.
          // Nothing further to do here; the primary flag guard covers this.
        }
      }
    }
    return {
      projection: null,
      deferred: true,
      missingIdentityLinks: true,
      reconciledCount: 0,
      retryCount: requestedServicesDefined ? requestedServices.length : 0,
    };
  }

  const qualificationStatus: AncillaryQualificationStatus =
    (screening as { qualifyingTests?: string[] | null }).qualifyingTests?.length
      ? "qualified"
      : "unscreened";
  const adminReviewStatus: AncillaryAdminReviewStatus =
    (screening as { adminApprovalStatus?: string }).adminApprovalStatus === "approved"
      ? "approved"
      : "pending";

  const inputs: ReconcileInput[] = requestedServices.map((serviceType) => ({
    clinicId,
    globalPlexusPatientId,
    patientClinicMembershipId,
    originatingScreeningId: screening.id,
    executionCaseId,
    serviceType,
    qualificationStatus,
    adminReviewStatus,
    source,
    actorUserId,
  }));
  const bulk = await reconcileAncillaryCasesBulk(inputs);

  const failedServices = new Set<string>();
  for (const err of bulk.errors) {
    failedServices.add(err.serviceType);
    try {
      await recordAncillaryReconciliationFailure({
        patientScreeningId: screening.id,
        executionCaseId,
        clinicId,
        globalPlexusPatientId,
        patientClinicMembershipId,
        serviceType: err.serviceType,
        requestedAction: "ensure_active",
        sourceSystem: source,
        errorCode: err.code ?? "unknown",
      });
    } catch { /* see above */ }
  }
  for (const r of bulk.ok) {
    if (r.status === "integrity_failure" || r.status === "missing_identity_links") {
      failedServices.add(r.serviceType);
      try {
        await recordAncillaryReconciliationFailure({
          patientScreeningId: screening.id,
          executionCaseId,
          clinicId,
          globalPlexusPatientId,
          patientClinicMembershipId,
          serviceType: r.serviceType,
          requestedAction: "ensure_active",
          sourceSystem: source,
          errorCode: r.status === "integrity_failure" ? `INTEGRITY:${r.reason}` : "MISSING_IDENTITY_LINKS",
        });
      } catch { /* see above */ }
    }
  }

  // Conservative on_hold: strictly for services INTENTIONALLY dropped
  // by the caller (requestedServicesDefined AND absent from list) AND
  // not currently failed to reconcile. Never triggered by an error.
  if (requestedServicesDefined) {
    const requestedSet = new Set(requestedServices);
    const active = await listAncillaryCasesForPatient(globalPlexusPatientId);
    const droppedServiceTypes = active
      .filter(
        (a) =>
          a.clinicId === clinicId &&
          !requestedSet.has(a.serviceType) &&
          !failedServices.has(a.serviceType) &&
          (a.lifecycleStatus === "new" || a.lifecycleStatus === "active"),
      )
      .map((a) => a.serviceType);
    for (const st of droppedServiceTypes) {
      await conservativelyRemoveAncillaryService({
        clinicId,
        globalPlexusPatientId,
        serviceType: st,
        action: "on_hold",
        source,
        actorUserId,
      });
    }
  }

  const successfullyReconciled = new Set(
    bulk.ok
      .filter((r) => r.status === "created" || r.status === "reused")
      .map((r) => (r as { serviceType: string }).serviceType),
  );

  const projection = await projectSelectedServicesFromAncillaryCases({
    globalPlexusPatientId,
    clinicId,
  });

  return {
    projection,
    deferred: false,
    missingIdentityLinks: false,
    reconciledCount: successfullyReconciled.size,
    retryCount: failedServices.size,
  };
}
