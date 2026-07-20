/**
 * Shared Plexus identity orchestration for the screening ingestion
 * pipeline. Every server-side path that INSERTs a
 * `patient_screenings` row calls this AFTER the insert.
 *
 * Behavior contract:
 *
 *   FEATURE_PLEXUS_IDENTITY_WRITE = OFF (default):
 *     • Returns { status: "skipped_flag_off" } immediately.
 *     • Zero DB reads. Zero DB writes. Zero perceptible latency.
 *     • Existing ingestion behavior is unchanged.
 *
 *   FEATURE_PLEXUS_IDENTITY_WRITE = ON:
 *     • Resolves the incoming demographics against the global registry.
 *     • Creates or reuses the global patient + clinic membership.
 *     • Updates patient_screenings.patient_clinic_membership_id and
 *       patient_screenings.global_plexus_patient_id transactionally.
 *     • On ambiguous (possible_match) — creates a Plexus-only review
 *       candidate and STILL links the clinic workflow to the new
 *       global patient (never blocks the clinic user with a
 *       cross-clinic review prompt).
 *     • On schema-configuration error (migration not applied) —
 *       propagates the structured error from the repository layer
 *       (never returns a false no_match).
 *
 * Failure model:
 *   • Never fire-and-forget. Every caller awaits the returned promise.
 *   • Never silently swallows a failure. Route callers translate the
 *     structured error into their preferred non-blocking response
 *     (usually: log + continue) at the boundary.
 *
 * Tenant scope:
 *   • clinicId is REQUIRED. A screening with a null clinicId is a
 *     pre-backfill row and the orchestrator returns
 *     { status: "skipped_no_clinic" } without touching anything.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../../lib/featureFlags";
import {
  commitResolution,
  resolveIdentity,
  type IdentityResolutionInput,
} from "./resolver";

export type ScreeningIdentityOrchestrationInput = {
  screeningId: number;
  clinicId: number | null;
  sourceSystem?: string | null;
  sourcePatientIdentifier?: string | null;
  clinicMrn?: string | null;
  demographics: {
    displayName?: string | null;
    dob?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  /**
   * When true (default), the orchestrator wraps the resolver commit +
   * the screening UPDATE in a single Drizzle transaction. Set to false
   * only in test paths where the caller manages the transaction.
   */
  useTransaction?: boolean;
};

export type ScreeningIdentityOrchestrationResult =
  | { status: "skipped_flag_off" }
  | { status: "skipped_no_clinic"; screeningId: number }
  | {
      status: "linked";
      screeningId: number;
      globalPlexusPatientId: number;
      plexusId: string;
      patientClinicMembershipId: number;
      isNewGlobal: boolean;
      isNewMembership: boolean;
      resolutionOutcome: "definitive_match" | "possible_match" | "no_match";
      queuedCandidateIds: number[];
    };

export async function resolveAndLinkPlexusIdentityForScreening(
  input: ScreeningIdentityOrchestrationInput,
): Promise<ScreeningIdentityOrchestrationResult> {
  if (!featureFlags.plexusIdentityWrite) {
    return { status: "skipped_flag_off" };
  }
  if (input.clinicId == null) {
    return { status: "skipped_no_clinic", screeningId: input.screeningId };
  }

  const resolverInput: IdentityResolutionInput = {
    clinicId: input.clinicId,
    displayName: input.demographics.displayName ?? null,
    dob: input.demographics.dob ?? null,
    phone: input.demographics.phone ?? null,
    email: input.demographics.email ?? null,
    clinicMrn: input.clinicMrn ?? null,
    sourceSystem: input.sourceSystem ?? null,
    sourcePatientIdentifier: input.sourcePatientIdentifier ?? null,
  };

  const useTx = input.useTransaction ?? true;

  const doWork = async (): Promise<ScreeningIdentityOrchestrationResult> => {
    const resolution = await resolveIdentity(resolverInput);
    const commit = await commitResolution({ input: resolverInput, resolution });

    await db
      .update(patientScreenings)
      .set({
        patientClinicMembershipId: commit.membershipId,
        globalPlexusPatientId: commit.globalPlexusPatientId,
      })
      .where(eq(patientScreenings.id, input.screeningId));

    return {
      status: "linked",
      screeningId: input.screeningId,
      globalPlexusPatientId: commit.globalPlexusPatientId,
      plexusId: commit.plexusId,
      patientClinicMembershipId: commit.membershipId,
      isNewGlobal: commit.isNewGlobal,
      isNewMembership: commit.isNewMembership,
      resolutionOutcome: resolution.outcome,
      queuedCandidateIds: commit.queuedCandidateIds,
    };
  };

  if (!useTx) return doWork();
  // Drizzle's transaction wrapper propagates the returned value.
  return db.transaction(async () => doWork());
}

/**
 * Convenience helper for the bulk ingestion paths (import-file,
 * import-text, plexus-iq clinical import). Iterates the input list
 * serially so schema-configuration failures surface immediately
 * instead of being masked by a Promise.all rejection race.
 *
 * Errors from individual rows are captured in the returned result so
 * the calling route can log them without swallowing (per the audit
 * rule against `.catch(() => {})`).
 */
export type BulkOrchestrationEntry = ScreeningIdentityOrchestrationInput;
export type BulkOrchestrationResult = {
  ok: ScreeningIdentityOrchestrationResult[];
  errors: Array<{
    screeningId: number;
    code: string | undefined;
    message: string;
  }>;
};

export async function resolveAndLinkPlexusIdentityForScreeningsBulk(
  inputs: BulkOrchestrationEntry[],
): Promise<BulkOrchestrationResult> {
  const ok: ScreeningIdentityOrchestrationResult[] = [];
  const errors: BulkOrchestrationResult["errors"] = [];

  // Fast path: flag OFF → single flag check, no per-row overhead.
  if (!featureFlags.plexusIdentityWrite) {
    for (const _ of inputs) ok.push({ status: "skipped_flag_off" });
    return { ok, errors };
  }

  for (const entry of inputs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await resolveAndLinkPlexusIdentityForScreening(entry);
      ok.push(r);
    } catch (e) {
      errors.push({
        screeningId: entry.screeningId,
        code: (e as { code?: string })?.code,
        message: (e as Error)?.message ?? String(e),
      });
    }
  }
  return { ok, errors };
}
