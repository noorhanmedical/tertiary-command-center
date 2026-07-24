/**
 * Phase 2A → 2B → 2D integration hook.
 *
 * Invoked (awaited, never fire-and-forget) after a screening's Phase 2A
 * identity links are established. When a quick-schedule execution case
 * for that screening/clinic is now identity-complete, this deterministically
 * finalizes the canonical chain (ancillary case + same_day_add event) and
 * closes the Phase 2B / Phase 2D retry rows.
 *
 * Contract:
 *   • Feature-flagged (FEATURE_CANONICAL_APPOINTMENT). Flag OFF → no-op.
 *   • Idempotent — finalize is reuse-first, so repeat calls never create
 *     duplicate cases / events / retry rows.
 *   • Never crosses clinics; never fabricates ids.
 *   • On failure records a durable retry and never throws to the caller
 *     (identity linking must not be broken by a downstream 2D issue).
 */

import { featureFlags } from "../../lib/featureFlags";
import { getExecutionCaseByScreeningId } from "../../repositories/executionCase.repo";
import { listUnresolvedAncillaryReconciliationFailures } from "../../repositories/ancillaryCases.repo";
import { recordCanonicalAppointmentFailure } from "../../repositories/canonicalAppointments.repo";
import { finalizeQuickScheduleCanonicalLink, type FinalizeQuickScheduleResult } from "./quickScheduleLink";

export type IdentityCompletionHookInput = {
  screeningId: number;
  clinicId: number;
  source?: string;
};

export type IdentityCompletionHookResult =
  | { status: "skipped_flag_off" }
  | { status: "no_quick_schedule_case" }
  | { status: "cross_clinic_skipped" }
  | { status: "finalized"; result: FinalizeQuickScheduleResult };

export async function finalizeQuickScheduleForLinkedScreening(
  input: IdentityCompletionHookInput,
): Promise<IdentityCompletionHookResult> {
  if (!featureFlags.canonicalAppointment) return { status: "skipped_flag_off" };
  const source = input.source ?? "identity_completion";

  try {
    const execCase = await getExecutionCaseByScreeningId(input.screeningId);
    if (!execCase) return { status: "no_quick_schedule_case" };

    // Only act on quick-schedule cases with pending canonical work.
    const openRows = await listUnresolvedAncillaryReconciliationFailures({
      executionCaseId: execCase.id,
      limit: 50,
    });
    const isQuickSchedule = execCase.source === "quick_schedule" || openRows.length > 0;
    if (!isQuickSchedule) return { status: "no_quick_schedule_case" };

    // Never cross clinics.
    if (execCase.clinicId != null && execCase.clinicId !== input.clinicId) {
      return { status: "cross_clinic_skipped" };
    }

    const result = await finalizeQuickScheduleCanonicalLink({
      clinicId: input.clinicId,
      executionCaseId: execCase.id,
      patientScreeningId: input.screeningId,
      source,
    });
    return { status: "finalized", result };
  } catch (e) {
    // Durable retry; NEVER rethrow — identity linking must not break.
    try {
      await recordCanonicalAppointmentFailure({
        clinicId: input.clinicId,
        ancillaryCaseId: null,
        patientScreeningId: input.screeningId,
        executionCaseId: null,
        requestedAction: "link_quick_schedule",
        sourceSystem: source,
        errorCode: (e as { code?: string })?.code ?? "identity_hook_failed",
      });
    } catch {
      /* ledger guard downstream */
    }
    return { status: "no_quick_schedule_case" };
  }
}
