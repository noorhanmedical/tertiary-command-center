/**
 * Phase 2B (hardened) — durable retry service for ancillary-case
 * reconciliation failures.
 *
 * Invoked from:
 *   • A future background job (not registered in this phase — an
 *     admin CLI or scheduler will call it).
 *   • The Phase 2A → Phase 2B completion hook: after a screening's
 *     Phase 2A identity links are established, drain any
 *     `MISSING_IDENTITY_LINKS` retry rows for that screening.
 *
 * Retry is idempotent because `reconcileAncillaryCaseForService`
 * itself is idempotent — an active case reuses, a missing one
 * creates. A resolved failure row is closed via
 * `resolveAncillaryReconciliationFailure`.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../../lib/featureFlags";
import {
  listUnresolvedAncillaryReconciliationFailures,
  resolveAncillaryReconciliationFailure,
  recordAncillaryReconciliationFailure,
  type RecordAncillaryReconciliationFailureInput,
} from "../../repositories/ancillaryCases.repo";
import {
  reconcileAncillaryCaseForService,
  conservativelyRemoveAncillaryService,
} from "./reconciliation";
import type { AncillaryCaseReconciliationFailure } from "@shared/schema/ancillaryCases";

export type RetryOutcome =
  | { status: "flag_off" }
  | { status: "resolved"; failureId: number; serviceType: string }
  | { status: "still_missing_identity"; failureId: number; serviceType: string }
  | { status: "error"; failureId: number; serviceType: string; code?: string; message: string };

async function retryOneFailure(
  f: AncillaryCaseReconciliationFailure,
): Promise<RetryOutcome> {
  // Re-read the screening if we have one — Phase 2A links may have
  // been backfilled since the failure was recorded.
  let globalPlexusPatientId = f.globalPlexusPatientId ?? null;
  let patientClinicMembershipId = f.patientClinicMembershipId ?? null;

  if (f.patientScreeningId != null) {
    const [scr] = await db
      .select()
      .from(patientScreenings)
      .where(eq(patientScreenings.id, f.patientScreeningId))
      .limit(1);
    if (scr) {
      globalPlexusPatientId =
        (scr as { globalPlexusPatientId?: number | null }).globalPlexusPatientId ?? globalPlexusPatientId;
      patientClinicMembershipId =
        (scr as { patientClinicMembershipId?: number | null }).patientClinicMembershipId ?? patientClinicMembershipId;
    }
  }

  if (!globalPlexusPatientId || !patientClinicMembershipId) {
    // Bump the attempt counter and continue.
    try {
      await recordAncillaryReconciliationFailure({
        patientScreeningId: f.patientScreeningId,
        executionCaseId: f.executionCaseId,
        clinicId: f.clinicId,
        globalPlexusPatientId,
        patientClinicMembershipId,
        serviceType: f.serviceType,
        requestedAction: f.requestedAction as RecordAncillaryReconciliationFailureInput["requestedAction"],
        sourceSystem: f.sourceSystem ?? "failure_retry_service",
        errorCode: "MISSING_IDENTITY_LINKS",
      });
    } catch { /* migration guard already handled */ }
    return { status: "still_missing_identity", failureId: f.id, serviceType: f.serviceType };
  }

  try {
    if (f.requestedAction === "ensure_active") {
      const r = await reconcileAncillaryCaseForService({
        clinicId: f.clinicId,
        globalPlexusPatientId,
        patientClinicMembershipId,
        originatingScreeningId: f.patientScreeningId ?? null,
        executionCaseId: f.executionCaseId ?? null,
        serviceType: f.serviceType,
        source: "failure_retry",
      });
      if (r.status === "reused" || r.status === "created") {
        await resolveAncillaryReconciliationFailure({
          serviceType: f.serviceType,
          executionCaseId: f.executionCaseId,
          patientScreeningId: f.patientScreeningId,
          requestedAction: "ensure_active",
        });
        return { status: "resolved", failureId: f.id, serviceType: f.serviceType };
      }
      // Failed / integrity failure — bump attempt.
      try {
        await recordAncillaryReconciliationFailure({
          patientScreeningId: f.patientScreeningId,
          executionCaseId: f.executionCaseId,
          clinicId: f.clinicId,
          globalPlexusPatientId,
          patientClinicMembershipId,
          serviceType: f.serviceType,
          requestedAction: "ensure_active",
          sourceSystem: "failure_retry_service",
          errorCode:
            r.status === "integrity_failure" ? `INTEGRITY:${r.reason}` :
              r.status === "missing_identity_links" ? "MISSING_IDENTITY_LINKS" : "unexpected_status",
        });
      } catch { /* see above */ }
      return { status: "error", failureId: f.id, serviceType: f.serviceType, code: r.status, message: r.status };
    }

    if (f.requestedAction === "place_on_hold" || f.requestedAction === "cancel" || f.requestedAction === "archive") {
      await conservativelyRemoveAncillaryService({
        clinicId: f.clinicId,
        globalPlexusPatientId,
        serviceType: f.serviceType,
        action: f.requestedAction === "place_on_hold" ? "on_hold" : f.requestedAction === "cancel" ? "cancelled" : "archived",
        source: "failure_retry",
      });
      await resolveAncillaryReconciliationFailure({
        serviceType: f.serviceType,
        executionCaseId: f.executionCaseId,
        patientScreeningId: f.patientScreeningId,
        requestedAction: f.requestedAction as RecordAncillaryReconciliationFailureInput["requestedAction"],
      });
      return { status: "resolved", failureId: f.id, serviceType: f.serviceType };
    }

    // refresh_projection — reconciler's projection helper is idempotent
    // and stateless; just close the row.
    await resolveAncillaryReconciliationFailure({
      serviceType: f.serviceType,
      executionCaseId: f.executionCaseId,
      patientScreeningId: f.patientScreeningId,
      requestedAction: "refresh_projection",
    });
    return { status: "resolved", failureId: f.id, serviceType: f.serviceType };
  } catch (e) {
    // Genuine error — bump attempt and continue.
    try {
      await recordAncillaryReconciliationFailure({
        patientScreeningId: f.patientScreeningId,
        executionCaseId: f.executionCaseId,
        clinicId: f.clinicId,
        globalPlexusPatientId,
        patientClinicMembershipId,
        serviceType: f.serviceType,
        requestedAction: f.requestedAction as RecordAncillaryReconciliationFailureInput["requestedAction"],
        sourceSystem: "failure_retry_service",
        errorCode: (e as { code?: string })?.code ?? "unknown",
      });
    } catch { /* see above */ }
    return { status: "error", failureId: f.id, serviceType: f.serviceType, code: (e as { code?: string })?.code, message: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Idempotent retry of a single failure. Used by callers that want
 * precise control (e.g. Phase 2A identity-completion hook: retry only
 * the failures for the affected screening).
 */
export async function retryAncillaryCaseReconciliationFailure(
  failure: AncillaryCaseReconciliationFailure,
): Promise<RetryOutcome> {
  if (!featureFlags.ancillaryCaseWrite) return { status: "flag_off" };
  return retryOneFailure(failure);
}

/**
 * Batch retry — used by a background job / admin CLI.
 */
export async function retryUnresolvedAncillaryCaseReconciliations(args?: {
  clinicId?: number;
  screeningId?: number;
  executionCaseId?: number;
  limit?: number;
}): Promise<{
  attempted: number;
  resolved: number;
  stillMissingIdentity: number;
  errors: number;
  outcomes: RetryOutcome[];
}> {
  if (!featureFlags.ancillaryCaseWrite) {
    return { attempted: 0, resolved: 0, stillMissingIdentity: 0, errors: 0, outcomes: [] };
  }
  const failures = await listUnresolvedAncillaryReconciliationFailures(args);
  const outcomes: RetryOutcome[] = [];
  for (const f of failures) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await retryOneFailure(f));
  }
  return {
    attempted: outcomes.length,
    resolved: outcomes.filter((o) => o.status === "resolved").length,
    stillMissingIdentity: outcomes.filter((o) => o.status === "still_missing_identity").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    outcomes,
  };
}

/**
 * Phase 2A → Phase 2B integration boundary. Called after a screening's
 * Phase 2A identity links have been established (either via the Phase
 * 2A backfill or in-line during a fresh ingestion). Retries any
 * failure rows blocked on MISSING_IDENTITY_LINKS for this screening.
 *
 * Safe to call at any time — flag OFF → no-op; migration missing →
 * safeRead re-throws which the caller is expected to catch (or the
 * ingestion path is skipped anyway).
 */
export async function retryFailuresAfterIdentityCompletion(
  screeningId: number,
): Promise<void> {
  if (!featureFlags.ancillaryCaseWrite) return;
  try {
    await retryUnresolvedAncillaryCaseReconciliations({ screeningId });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn",
      source: "ancillary_case_retry",
      site: "retryFailuresAfterIdentityCompletion",
      screeningId,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}
