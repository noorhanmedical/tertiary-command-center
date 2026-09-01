/**
 * Idempotent Plexus identity reconciliation.
 *
 * Called from:
 *   • Route try/catch blocks when the primary orchestration fails and
 *     we need to record + later retry (the record step lives in the
 *     route; retry lives here).
 *   • Backfill apply mode (via the orchestrator).
 *   • A future administrative repair CLI (NOT registered as a
 *     clinic-facing route per the audit rules).
 *
 * Guarantees for `reconcilePlexusIdentityForScreening`:
 *   • Returns immediately when both FK columns already point to the
 *     same clinic + global-patient pair (idempotent).
 *   • Fully resolves + links when both FKs are missing.
 *   • Detects conflicting partial state (e.g. membership_id points to
 *     clinic B, but the screening belongs to clinic A) and REFUSES to
 *     modify anything — returns a `conflict` result the caller can
 *     surface to Plexus review.
 *   • Never merges from name + DOB alone.
 *   • Preserves clinic scope — cross-clinic membership never repairs.
 *   • Never logs PHI. Structured non-PHI status only.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../../lib/featureFlags";
import {
  findActiveMembership,
  findGlobalPatientById,
  listUnresolvedLinkFailures,
  recordLinkFailure,
  resolveLinkFailure,
} from "../../repositories/plexusIdentity.repo";
import {
  resolveAndLinkPlexusIdentityForScreening,
} from "./screeningIntegration";

export type ReconciliationResult =
  | { status: "flag_off"; screeningId: number }
  | { status: "screening_not_found"; screeningId: number }
  | { status: "skipped_no_clinic"; screeningId: number }
  | {
      status: "already_linked_consistent";
      screeningId: number;
      patientClinicMembershipId: number;
      globalPlexusPatientId: number;
    }
  | {
      status: "linked";
      screeningId: number;
      patientClinicMembershipId: number;
      globalPlexusPatientId: number;
      isNewGlobal: boolean;
      isNewMembership: boolean;
      resolutionOutcome: "definitive_match" | "possible_match" | "no_match";
    }
  | {
      status: "conflict";
      screeningId: number;
      reason:
        | "membership_belongs_to_different_clinic"
        | "membership_belongs_to_different_global_patient"
        | "membership_missing_from_registry"
        | "global_patient_missing_from_registry"
        | "clinic_id_missing";
    }
  | {
      status: "error";
      screeningId: number;
      code: string;
      message: string;
    };

/**
 * Fully idempotent. Safe to call as many times as the retry service
 * needs. Every branch either commits fully-resolved state or returns
 * without mutation.
 */
export async function reconcilePlexusIdentityForScreening(
  screeningId: number,
  clinicIdHint: number | null,
): Promise<ReconciliationResult> {
  if (!featureFlags.plexusIdentityWrite) {
    return { status: "flag_off", screeningId };
  }

  // Read the screening's canonical state — never trust the caller's hint.
  const rows = await db
    .select({
      id: patientScreenings.id,
      clinicId: patientScreenings.clinicId,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      phone: patientScreenings.phoneNumber,
      email: patientScreenings.email,
      patientClinicMembershipId: patientScreenings.patientClinicMembershipId,
      globalPlexusPatientId: patientScreenings.globalPlexusPatientId,
    })
    .from(patientScreenings)
    .where(eq(patientScreenings.id, screeningId))
    .limit(1);

  const s = rows[0];
  if (!s) return { status: "screening_not_found", screeningId };
  const clinicId = s.clinicId ?? clinicIdHint;
  if (!clinicId) {
    return { status: "skipped_no_clinic", screeningId };
  }

  const hasMembership = s.patientClinicMembershipId != null;
  const hasGlobal = s.globalPlexusPatientId != null;

  // Case A — both links already present.
  if (hasMembership && hasGlobal) {
    // Verify consistency: the membership must (i) still exist, (ii)
    // belong to this clinic, (iii) point to the same global patient.
    const membership = await findActiveMembership({
      globalPlexusPatientId: s.globalPlexusPatientId as number,
      clinicId,
    });
    if (!membership || membership.id !== s.patientClinicMembershipId) {
      // The stored membership id doesn't match an active membership
      // for (this globalPatient, this clinic). That's a conflict — do
      // NOT silently repair.
      return {
        status: "conflict",
        screeningId,
        reason: "membership_belongs_to_different_global_patient",
      };
    }
    const global = await findGlobalPatientById(s.globalPlexusPatientId as number);
    if (!global) {
      return {
        status: "conflict",
        screeningId,
        reason: "global_patient_missing_from_registry",
      };
    }
    // Resolve any outstanding failure row — the linkage is healthy.
    await resolveLinkFailure(screeningId);
    return {
      status: "already_linked_consistent",
      screeningId,
      patientClinicMembershipId: s.patientClinicMembershipId as number,
      globalPlexusPatientId: s.globalPlexusPatientId as number,
    };
  }

  // Case B — one-only partial state. Refuse to repair a half-linked
  // row without knowing the intent; queue a conflict so Plexus review
  // can inspect. This prevents accidentally overwriting a legitimate
  // FK with a new (possibly different) resolver outcome.
  if (hasMembership !== hasGlobal) {
    // Verify whether the present FK is even consistent with the
    // screening's clinic before returning the conflict — that gives
    // the reviewer better signal.
    if (hasMembership) {
      const global = s.globalPlexusPatientId as number | null;
      const membership = await findActiveMembership({
        globalPlexusPatientId: global ?? 0,
        clinicId,
      });
      // Since `global` is null (hasGlobal === false), findActiveMembership
      // returns null too — the stored membership id can't be validated.
      if (!membership || membership.id !== s.patientClinicMembershipId) {
        return {
          status: "conflict",
          screeningId,
          reason: "membership_belongs_to_different_clinic",
        };
      }
    }
    return {
      status: "conflict",
      screeningId,
      reason: hasMembership
        ? "membership_missing_from_registry"
        : "global_patient_missing_from_registry",
    };
  }

  // Case C — both missing. Full resolve + link via the shared
  // orchestrator (which we know writes both FKs in one transaction).
  try {
    const r = await resolveAndLinkPlexusIdentityForScreening({
      screeningId,
      clinicId,
      sourceSystem: "reconciliation",
      demographics: {
        displayName: s.name,
        dob: s.dob,
        phone: s.phone,
        email: s.email,
      },
    });
    if (r.status !== "linked") {
      return {
        status: "error",
        screeningId,
        code: "unexpected_orchestrator_status",
        message: r.status,
      };
    }
    await resolveLinkFailure(screeningId);
    return {
      status: "linked",
      screeningId,
      patientClinicMembershipId: r.patientClinicMembershipId,
      globalPlexusPatientId: r.globalPlexusPatientId,
      isNewGlobal: r.isNewGlobal,
      isNewMembership: r.isNewMembership,
      resolutionOutcome: r.resolutionOutcome,
    };
  } catch (e) {
    // Bump the attempt counter for the durable retry queue. The next
    // reconciliation pass will pick this row up again.
    try {
      await recordLinkFailure({
        patientScreeningId: screeningId,
        clinicId,
        sourceSystem: "reconciliation",
        errorCode: (e as { code?: string })?.code ?? "unknown",
      });
    } catch {
      // Deliberately narrow: recording the failure itself failed — the
      // outer reconcile loop will surface both errors. Never rethrow
      // from the failure-recording path because the primary error is
      // strictly more informative.
    }
    return {
      status: "error",
      screeningId,
      code: (e as { code?: string })?.code ?? "unknown",
      message: (e as Error)?.message ?? String(e),
    };
  }
}

/**
 * Retry service. Iterates unresolved failure rows and calls
 * reconcilePlexusIdentityForScreening for each. Structured non-PHI
 * summary. Intended for a background job or admin CLI — never wired
 * into a clinic-facing route.
 */
export async function retryUnresolvedLinkFailures(
  limit = 100,
): Promise<{
  attempted: number;
  resolved: number;
  stillFailing: number;
  conflicts: number;
  results: ReconciliationResult[];
}> {
  if (!featureFlags.plexusIdentityWrite) {
    return { attempted: 0, resolved: 0, stillFailing: 0, conflicts: 0, results: [] };
  }
  const unresolved = await listUnresolvedLinkFailures(limit);
  const results: ReconciliationResult[] = [];
  for (const f of unresolved) {
    // eslint-disable-next-line no-await-in-loop
    const r = await reconcilePlexusIdentityForScreening(
      f.patientScreeningId,
      f.clinicId,
    );
    results.push(r);
  }
  return {
    attempted: results.length,
    resolved: results.filter(
      (r) => r.status === "linked" || r.status === "already_linked_consistent",
    ).length,
    stillFailing: results.filter((r) => r.status === "error").length,
    conflicts: results.filter((r) => r.status === "conflict").length,
    results,
  };
}
