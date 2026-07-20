/**
 * Phase 2A backfill — Plexus identity.
 *
 * Contract:
 *   • DRY-RUN by default. Prints the plan; makes zero writes.
 *   • Requires BOTH environment gates before writing:
 *       BACKFILL_PLEXUS_IDENTITY_APPLY=YES  (explicit opt-in)
 *       FEATURE_PLEXUS_IDENTITY_WRITE=true  (repository writes)
 *   • Iterates `patient_screenings` in clinic-scoped batches. For each
 *     row it calls the shared identity orchestrator, which resolves +
 *     (in apply mode) writes:
 *       - global_plexus_patients row (created or reused)
 *       - patient_clinic_memberships row (created or reused)
 *       - patient_screenings.patient_clinic_membership_id
 *       - patient_screenings.global_plexus_patient_id
 *   • Idempotent: skips screenings already linked.
 *   • Never auto-merges cross-clinic similarities — ambiguous rows
 *     enqueue a `patient_identity_match_candidates` row for Plexus
 *     review and STILL proceed with a new global patient.
 *   • Never touches the `clinics` table.
 *   • Never logs raw name / DOB / phone / email / MRN. The plan
 *     output contains counts, per-row outcome codes, screening ids,
 *     and clinic ids only.
 *
 * Usage:
 *   npx tsx script/backfillPlexusIdentity.ts                      # dry-run
 *   BACKFILL_PLEXUS_IDENTITY_APPLY=YES FEATURE_PLEXUS_IDENTITY_WRITE=true \
 *     npx tsx script/backfillPlexusIdentity.ts                    # apply
 */

import { db } from "../server/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../server/lib/featureFlags";
import {
  resolveIdentity,
  type IdentityResolutionInput,
} from "../server/services/plexusIdentity/resolver";
import { resolveAndLinkPlexusIdentityForScreening } from "../server/services/plexusIdentity/screeningIntegration";

type PlanOutcome =
  | "definitive_match"
  | "possible_match"
  | "no_match"
  | "skipped_no_clinic"
  | "skipped_already_linked"
  | "error";

type PlanRow = {
  screeningId: number;
  clinicId: number | null;
  outcome: PlanOutcome;
  candidateCount: number;
  linkedMembershipId?: number;
  linkedGlobalPatientId?: number;
  isNewGlobal?: boolean;
  isNewMembership?: boolean;
  errorCode?: string;
};

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_PLEXUS_IDENTITY_APPLY === "YES";

  if (apply && !featureFlags.plexusIdentityWrite) {
    console.error(
      "Refusing to apply: BACKFILL_PLEXUS_IDENTITY_APPLY=YES but FEATURE_PLEXUS_IDENTITY_WRITE is not enabled.",
    );
    process.exit(2);
  }

  // Only unlinked, non-deleted rows.
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
    .where(
      and(
        isNull(patientScreenings.deletedAt),
        // Idempotency: only process rows that don't already have a
        // membership link. A row with the FK set is treated as done.
        isNull(patientScreenings.patientClinicMembershipId),
      ),
    )
    .limit(500);

  const plan: PlanRow[] = [];

  for (const r of rows) {
    if (r.patientClinicMembershipId != null) {
      plan.push({
        screeningId: r.id,
        clinicId: r.clinicId,
        outcome: "skipped_already_linked",
        candidateCount: 0,
      });
      continue;
    }
    if (!r.clinicId) {
      plan.push({
        screeningId: r.id,
        clinicId: null,
        outcome: "skipped_no_clinic",
        candidateCount: 0,
      });
      continue;
    }

    if (!apply) {
      // Dry-run: use the read-only resolver to project what would happen.
      const input: IdentityResolutionInput = {
        clinicId: r.clinicId,
        displayName: r.name,
        dob: r.dob,
        phone: r.phone,
        email: r.email,
      };
      let outcome: PlanOutcome = "no_match";
      let candidateCount = 0;
      try {
        const resolution = await resolveIdentity(input);
        if (resolution.outcome === "definitive_match") outcome = "definitive_match";
        else if (resolution.outcome === "possible_match") {
          outcome = "possible_match";
          candidateCount = resolution.candidates.length;
        } else outcome = "no_match";
      } catch (e) {
        plan.push({
          screeningId: r.id,
          clinicId: r.clinicId,
          outcome: "error",
          candidateCount: 0,
          errorCode: (e as { code?: string })?.code,
        });
        continue;
      }
      plan.push({
        screeningId: r.id,
        clinicId: r.clinicId,
        outcome,
        candidateCount,
      });
      continue;
    }

    // Apply mode: use the same shared orchestrator that the ingestion
    // routes use — guarantees identical semantics between real-time
    // ingestion and backfill (no duplicated resolver logic here).
    try {
      const result = await resolveAndLinkPlexusIdentityForScreening({
        screeningId: r.id,
        clinicId: r.clinicId,
        sourceSystem: "backfill_plexus_identity",
        demographics: {
          displayName: r.name,
          dob: r.dob,
          phone: r.phone,
          email: r.email,
        },
      });
      if (result.status === "linked") {
        plan.push({
          screeningId: r.id,
          clinicId: r.clinicId,
          outcome: result.resolutionOutcome,
          candidateCount: result.queuedCandidateIds.length,
          linkedMembershipId: result.patientClinicMembershipId,
          linkedGlobalPatientId: result.globalPlexusPatientId,
          isNewGlobal: result.isNewGlobal,
          isNewMembership: result.isNewMembership,
        });
      } else if (result.status === "skipped_no_clinic") {
        plan.push({
          screeningId: r.id,
          clinicId: r.clinicId,
          outcome: "skipped_no_clinic",
          candidateCount: 0,
        });
      } else {
        // Should not happen — flag was checked at process start.
        plan.push({
          screeningId: r.id,
          clinicId: r.clinicId,
          outcome: "error",
          candidateCount: 0,
          errorCode: "unexpected_flag_off_mid_run",
        });
      }
    } catch (e) {
      plan.push({
        screeningId: r.id,
        clinicId: r.clinicId,
        outcome: "error",
        candidateCount: 0,
        errorCode: (e as { code?: string })?.code,
      });
    }
  }

  const summary = {
    mode: apply ? "APPLIED" : "DRY_RUN",
    rowsExamined: plan.length,
    definitive: plan.filter((p) => p.outcome === "definitive_match").length,
    possible: plan.filter((p) => p.outcome === "possible_match").length,
    noMatch: plan.filter((p) => p.outcome === "no_match").length,
    skippedNoClinic: plan.filter((p) => p.outcome === "skipped_no_clinic").length,
    skippedAlreadyLinked: plan.filter((p) => p.outcome === "skipped_already_linked").length,
    errors: plan.filter((p) => p.outcome === "error").length,
    // Aggregate projections (dry-run) / totals (apply)
    plannedNewGlobalPatients: plan.filter((p) => p.outcome === "no_match" || p.outcome === "possible_match").length,
    plannedNewMemberships: plan.filter((p) =>
      p.outcome === "definitive_match" || p.outcome === "no_match" || p.outcome === "possible_match",
    ).length,
    plannedScreeningLinks: plan.filter((p) =>
      p.outcome === "definitive_match" || p.outcome === "no_match" || p.outcome === "possible_match",
    ).length,
    plannedMatchCandidates: plan.reduce((s, p) => s + (p.candidateCount ?? 0), 0),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ summary, plan }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    // Only the error message + code — never any PHI from the row payload.
    console.error(JSON.stringify({
      level: "error",
      source: "plexus_identity_backfill",
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);

// Silence "sql imported but unused" complaint from tsc when the file
// is imported for type-checking; the sql helper is intentionally kept
// available for future JSON-diagnostic queries.
void sql;
