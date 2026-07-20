/**
 * Phase 2A backfill — Plexus identity.
 *
 * Behavior:
 *   • DRY-RUN by default. Prints the plan; makes no changes.
 *   • Requires BOTH environment gates before writing:
 *       BACKFILL_PLEXUS_IDENTITY_APPLY=YES  (explicit opt-in)
 *       FEATURE_PLEXUS_IDENTITY_WRITE=true  (repository writes)
 *   • Iterates `patient_screenings` in clinic-scoped batches, calling
 *     the resolver in READ mode. In apply mode it links each screening
 *     to a global patient + membership via the (nullable) transitional
 *     columns `global_plexus_patient_id` and `patient_clinic_membership_id`.
 *   • Idempotent: rows already linked are skipped.
 *   • Never uses (name, DOB) as a unique identifier; never auto-merges
 *     ambiguous rows. Possible-match rows are queued for Plexus review.
 *
 * Usage:
 *   npx tsx script/backfillPlexusIdentity.ts                      # dry-run
 *   BACKFILL_PLEXUS_IDENTITY_APPLY=YES FEATURE_PLEXUS_IDENTITY_WRITE=true \
 *     npx tsx script/backfillPlexusIdentity.ts                    # apply
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../server/lib/featureFlags";
import {
  resolveIdentity,
  commitResolution,
  type IdentityResolutionInput,
} from "../server/services/plexusIdentity/resolver";

type PlanRow = {
  screeningId: number;
  clinicId: number | null;
  outcome: "definitive_match" | "possible_match" | "no_match" | "skipped_no_clinic";
  linkedMembershipId?: number;
  candidateCount?: number;
};

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_PLEXUS_IDENTITY_APPLY === "YES";

  if (apply && !featureFlags.plexusIdentityWrite) {
    console.error(
      "Refusing to apply: BACKFILL_PLEXUS_IDENTITY_APPLY=YES but FEATURE_PLEXUS_IDENTITY_WRITE is not enabled.",
    );
    process.exit(2);
  }

  const rows = await db
    .select({
      id: patientScreenings.id,
      clinicId: patientScreenings.clinicId,
      name: patientScreenings.name,
      dob: patientScreenings.dob,
      phone: patientScreenings.phoneNumber,
      email: patientScreenings.email,
    })
    .from(patientScreenings)
    .where(sql`${patientScreenings.deletedAt} IS NULL`)
    .limit(500);

  const plan: PlanRow[] = [];

  for (const r of rows) {
    if (!r.clinicId) {
      plan.push({
        screeningId: r.id,
        clinicId: null,
        outcome: "skipped_no_clinic",
      });
      continue;
    }
    const input: IdentityResolutionInput = {
      clinicId: r.clinicId,
      displayName: r.name,
      dob: r.dob,
      phone: r.phone,
      email: r.email,
    };
    const resolution = await resolveIdentity(input);

    if (!apply) {
      plan.push({
        screeningId: r.id,
        clinicId: r.clinicId,
        outcome: resolution.outcome,
        candidateCount:
          resolution.outcome === "possible_match" ? resolution.candidates.length : 0,
      });
      continue;
    }

    const commit = await commitResolution({ input, resolution });
    await db.execute(sql`
      UPDATE patient_screenings
      SET patient_clinic_membership_id = ${commit.membershipId},
          global_plexus_patient_id = ${commit.globalPlexusPatientId}
      WHERE id = ${r.id}
    `);
    plan.push({
      screeningId: r.id,
      clinicId: r.clinicId,
      outcome: resolution.outcome,
      linkedMembershipId: commit.membershipId,
      candidateCount:
        resolution.outcome === "possible_match" ? commit.queuedCandidateIds.length : 0,
    });
  }

  const summary = {
    mode: apply ? "APPLIED" : "DRY_RUN",
    rowsExamined: plan.length,
    definitive: plan.filter((p) => p.outcome === "definitive_match").length,
    possible: plan.filter((p) => p.outcome === "possible_match").length,
    noMatch: plan.filter((p) => p.outcome === "no_match").length,
    skipped: plan.filter((p) => p.outcome === "skipped_no_clinic").length,
  };
  console.log(JSON.stringify({ summary, plan }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
