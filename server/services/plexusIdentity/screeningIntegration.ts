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
  recordLinkFailure,
  createExternalIdentifier,
  findExternalIdentifiersByMatchValue,
} from "../../repositories/plexusIdentity.repo";
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
  /**
   * Distinct external/source patient identifier (Patient ID / External ID /
   * EMR ID) — NEVER the MRN. When present and the screening links, it is
   * persisted as a canonical `ehr_patient_id` row in
   * patient_external_identifiers (idempotent per global patient). This is the
   * P0 "preserve BOTH MRN and Patient ID" persistence path.
   */
  externalPatientId?: string | null;
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

/** Normalize an external patient identifier for the match-value column
 *  (deterministic: trim + collapse whitespace + uppercase). */
function normalizeExternalId(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, " ").toUpperCase();
  return s.length > 0 ? s : null;
}

/** Persist a distinct external Patient ID as an `ehr_patient_id` row,
 *  idempotently per global patient. Never throws — an identifier failure must
 *  not break identity linkage; the caller has already linked the screening. */
async function persistExternalPatientIdentifier(args: {
  externalPatientId: string | null;
  globalPlexusPatientId: number;
  patientClinicMembershipId: number;
  clinicId: number;
  sourceSystem: string | null;
}): Promise<void> {
  const normalized = normalizeExternalId(args.externalPatientId);
  if (!normalized) return;
  try {
    const existing = await findExternalIdentifiersByMatchValue({
      identifierType: "ehr_patient_id",
      normalizedOrHashedMatchValue: normalized,
    });
    if (existing.some((e) => e.globalPlexusPatientId === args.globalPlexusPatientId)) {
      return; // already linked — idempotent no-op
    }
    await createExternalIdentifier({
      globalPlexusPatientId: args.globalPlexusPatientId,
      patientClinicMembershipId: args.patientClinicMembershipId,
      clinicId: args.clinicId,
      sourceSystem: args.sourceSystem,
      identifierType: "ehr_patient_id",
      // ehr_patient_id is NON-sensitive (SENSITIVE_IDENTIFIER_TYPES = payer/
      // medicare only), so the raw value is allowed; the normalized value drives
      // matching. MRN is NOT stored here — it lives on the clinic membership.
      identifierValueEncrypted: String(args.externalPatientId).trim(),
      normalizedOrHashedMatchValue: normalized,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error",
      source: "plexus_identity_integration",
      kind: "external_patient_id_persist_failed",
      globalPlexusPatientId: args.globalPlexusPatientId,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

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

    // P0 — preserve the DISTINCT external Patient ID as a canonical
    // `ehr_patient_id` external identifier (never folded into the MRN, which is
    // carried on the clinic membership). Idempotent per global patient so a
    // re-import never creates a duplicate identifier row. `ehr_patient_id` is a
    // NON-sensitive type (only payer/medicare are blocked), so it persists
    // through the existing repo without an encryption dependency.
    await persistExternalPatientIdentifier({
      externalPatientId: input.externalPatientId ?? null,
      globalPlexusPatientId: commit.globalPlexusPatientId,
      patientClinicMembershipId: commit.membershipId,
      clinicId: input.clinicId as number,
      sourceSystem: input.sourceSystem ?? null,
    });

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

  const result = useTx ? await db.transaction(async () => doWork()) : await doWork();

  // Phase 2A → 2B → 2D hook: once a screening is identity-linked, drain
  // any pending quick-schedule canonical work for its execution case.
  // Awaited (never fire-and-forget), flag-gated inside the hook, and it
  // never throws — a downstream 2D issue must not break identity linking.
  if (result.status === "linked" && featureFlags.canonicalAppointment && input.clinicId != null) {
    const { finalizeQuickScheduleForLinkedScreening } = await import(
      "../canonicalAppointments/identityCompletionHook"
    );
    await finalizeQuickScheduleForLinkedScreening({
      screeningId: input.screeningId,
      clinicId: input.clinicId,
      source: input.sourceSystem ?? "identity_link",
    });
  }

  return result;
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

/**
 * Route-facing wrapper: records a durable retry ledger row when the
 * primary orchestration fails on a screening that has already been
 * persisted. The route handler catches the orchestration error, logs
 * the structured code, and then calls this — so the failure is
 * durable across process restarts and the retry service can pick it
 * up on its next pass.
 *
 * Behavior:
 *   • Flag OFF → no-op (there should be no orchestration failures in
 *     the first place when the flag is off, but this guard prevents
 *     writing to a possibly-missing table).
 *   • Flag ON → routes through the repo. Structured non-PHI. Never
 *     throws to the caller — recording MUST NOT itself cascade into
 *     a 500 response.
 */
export async function recordScreeningIdentityLinkFailure(input: {
  screeningId: number;
  clinicId: number | null;
  sourceSystem: string;
  errorCode: string | undefined;
}): Promise<void> {
  if (!featureFlags.plexusIdentityWrite) return;
  try {
    await recordLinkFailure({
      patientScreeningId: input.screeningId,
      clinicId: input.clinicId,
      sourceSystem: input.sourceSystem,
      errorCode: input.errorCode ?? "unknown",
    });
  } catch (e) {
    // If we can't even write the failure row (e.g. migration missing),
    // structured-log it and continue. The primary orchestration error
    // has already been logged by the caller.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error",
      source: "plexus_identity_integration",
      kind: "failure_ledger_write_failed",
      screeningId: input.screeningId,
      code: (e as { code?: string })?.code,
      message: (e as Error)?.message ?? String(e),
    }));
  }
}

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
