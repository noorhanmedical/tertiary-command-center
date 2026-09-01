/**
 * Phase 2B backfill — patient_ancillary_cases.
 *
 * Contract:
 *   • DRY-RUN by default. Prints the plan; makes zero writes.
 *   • Requires BOTH environment gates before writing:
 *       BACKFILL_ANCILLARY_CASES_APPLY=YES  (explicit opt-in)
 *       FEATURE_ANCILLARY_CASE_WRITE=true   (repository writes)
 *   • Source: existing patient_execution_cases + selectedServices +
 *     screening linkage from Phase 2A.
 *   • Idempotent: reconciler reuses active rows; a row that already
 *     exists is not duplicated.
 *   • Never crosses clinic boundaries — the integrity validator
 *     refuses cross-clinic linkage.
 *   • Refuses rows missing Phase 2A identity links (structured
 *     `missing_identity_links` outcome; nothing is inserted).
 *   • Never touches clinics.
 *   • NEVER logs PHI. Output contains counts + ids + outcome codes.
 *
 * Usage:
 *   npx tsx script/backfillAncillaryCases.ts                       # dry-run
 *   BACKFILL_ANCILLARY_CASES_APPLY=YES FEATURE_ANCILLARY_CASE_WRITE=true \
 *     npx tsx script/backfillAncillaryCases.ts                     # apply
 */

import { db } from "../server/db";
import { and, isNull, sql } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { patientScreenings } from "@shared/schema/screening";
import { featureFlags } from "../server/lib/featureFlags";
import { reconcileAncillaryCaseForService } from "../server/services/ancillaryCases/reconciliation";

type PlanOutcome =
  | "reused"
  | "created"
  | "missing_identity_links"
  | "integrity_failure"
  | "skipped_no_services"
  | "skipped_no_clinic"
  | "error";

type PlanRow = {
  executionCaseId: number;
  screeningId: number | null;
  clinicId: number | null;
  serviceType: string;
  outcome: PlanOutcome;
  ancillaryCaseId?: number;
  episodeSequence?: number;
  errorCode?: string;
  reason?: string;
};

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_ANCILLARY_CASES_APPLY === "YES";

  if (apply && !featureFlags.ancillaryCaseWrite) {
    console.error(
      "Refusing to apply: BACKFILL_ANCILLARY_CASES_APPLY=YES but FEATURE_ANCILLARY_CASE_WRITE is not enabled.",
    );
    process.exit(2);
  }

  // Pull every non-archived execution case with selectedServices,
  // joined with the screening's Phase 2A identity links. We deliberately
  // do not join on identity tables directly here — the reconciler will
  // do the integrity check.
  //
  // Bounded LIMIT 1000 per invocation. Re-run to drain a larger set;
  // the reconciler is idempotent.
  const rows = await db
    .select({
      execId: patientExecutionCases.id,
      clinicId: patientExecutionCases.clinicId,
      screeningId: patientExecutionCases.patientScreeningId,
      selectedServices: patientExecutionCases.selectedServices,
      execLifecycle: patientExecutionCases.lifecycleStatus,
      execQualification: patientExecutionCases.qualificationStatus,
      // Phase 2A identity links (nullable pre-backfill).
      globalPlexusPatientId: patientScreenings.globalPlexusPatientId,
      patientClinicMembershipId: patientScreenings.patientClinicMembershipId,
      screeningName: patientScreenings.name,
      screeningDob: patientScreenings.dob,
      adminApprovalStatus: patientScreenings.adminApprovalStatus,
    })
    .from(patientExecutionCases)
    .leftJoin(
      patientScreenings,
      sql`${patientExecutionCases.patientScreeningId} = ${patientScreenings.id}`,
    )
    .where(
      and(
        // Skip archived/completed cases — Phase 2B ancillary cases
        // start from live engagement work.
        sql`${patientExecutionCases.lifecycleStatus} IN ('active')`,
        isNull(patientScreenings.deletedAt),
      ),
    )
    .limit(1000);

  const plan: PlanRow[] = [];

  for (const r of rows) {
    if (!r.clinicId) {
      plan.push({
        executionCaseId: r.execId,
        screeningId: r.screeningId,
        clinicId: null,
        serviceType: "",
        outcome: "skipped_no_clinic",
      });
      continue;
    }
    const services = Array.isArray(r.selectedServices) ? r.selectedServices : [];
    if (services.length === 0) {
      plan.push({
        executionCaseId: r.execId,
        screeningId: r.screeningId,
        clinicId: r.clinicId,
        serviceType: "",
        outcome: "skipped_no_services",
      });
      continue;
    }
    if (!r.globalPlexusPatientId || !r.patientClinicMembershipId) {
      // Refuse: Phase 2A identity links missing. Plan one row per
      // service so counts remain accurate.
      for (const st of services) {
        plan.push({
          executionCaseId: r.execId,
          screeningId: r.screeningId,
          clinicId: r.clinicId,
          serviceType: st,
          outcome: "missing_identity_links",
        });
      }
      continue;
    }

    const qualificationStatus =
      r.execQualification === "qualified" ? "qualified" :
        r.execQualification === "not_qualified" ? "not_qualified" :
          r.execQualification === "pending_review" ? "pending_review" : "unscreened";
    const adminReviewStatus =
      r.adminApprovalStatus === "approved" ? "approved" :
        r.adminApprovalStatus === "needs_info" ? "needs_info" :
          r.adminApprovalStatus === "rejected" ? "rejected" : "pending";

    for (const serviceType of services) {
      if (!apply) {
        // Dry-run: don't call the writing reconciler. Assume the
        // outcome is "created" unless an active row already exists —
        // we approximate by fetching that here for a truthful preview.
        // (This is the same active-row probe the reconciler uses.)
        const { findActiveAncillaryCase } = await import(
          "../server/repositories/ancillaryCases.repo"
        );
        try {
          const active = await findActiveAncillaryCase({
            globalPlexusPatientId: r.globalPlexusPatientId,
            clinicId: r.clinicId,
            serviceType,
          });
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: active ? "reused" : "created",
            ancillaryCaseId: active?.id,
            episodeSequence: active?.episodeSequence,
          });
        } catch (e) {
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: "error",
            errorCode: (e as { code?: string })?.code,
          });
        }
        continue;
      }
      try {
        const result = await reconcileAncillaryCaseForService({
          clinicId: r.clinicId,
          globalPlexusPatientId: r.globalPlexusPatientId,
          patientClinicMembershipId: r.patientClinicMembershipId,
          originatingScreeningId: r.screeningId ?? undefined,
          executionCaseId: r.execId,
          serviceType,
          qualificationStatus,
          adminReviewStatus,
          source: "backfill_ancillary_cases",
          // patientNameForAudit intentionally omitted — the backfill
          // must not log PHI. Journey events use the sentinel name.
          patientNameForAudit: null,
          patientDobForAudit: null,
        });
        if (result.status === "created") {
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: "created",
            ancillaryCaseId: result.ancillaryCaseId,
            episodeSequence: result.episodeSequence,
          });
        } else if (result.status === "reused") {
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: "reused",
            ancillaryCaseId: result.ancillaryCaseId,
            episodeSequence: result.episodeSequence,
          });
        } else if (result.status === "integrity_failure") {
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: "integrity_failure",
            reason: result.reason,
          });
        } else if (result.status === "missing_identity_links") {
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: "missing_identity_links",
          });
        } else {
          plan.push({
            executionCaseId: r.execId,
            screeningId: r.screeningId,
            clinicId: r.clinicId,
            serviceType,
            outcome: "error",
            errorCode: "unexpected_status:" + result.status,
          });
        }
      } catch (e) {
        plan.push({
          executionCaseId: r.execId,
          screeningId: r.screeningId,
          clinicId: r.clinicId,
          serviceType,
          outcome: "error",
          errorCode: (e as { code?: string })?.code,
        });
      }
    }
  }

  const executionCaseIds = new Set(plan.map((p) => p.executionCaseId));
  const summary = {
    mode: apply ? "APPLIED" : "DRY_RUN",
    executionCasesScanned: executionCaseIds.size,
    serviceRowsDiscovered: plan.length,
    alreadyRepresented: plan.filter((p) => p.outcome === "reused").length,
    plannedForCreation: plan.filter((p) => p.outcome === "created").length,
    missingIdentityLinks: plan.filter((p) => p.outcome === "missing_identity_links").length,
    integrityFailures: plan.filter((p) => p.outcome === "integrity_failure").length,
    conflicts: plan.filter((p) => p.outcome === "error").length,
    skippedNoServices: plan.filter((p) => p.outcome === "skipped_no_services").length,
    skippedNoClinic: plan.filter((p) => p.outcome === "skipped_no_clinic").length,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ summary, plan }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    // Only error message + code — never any PHI from the row payload.
    console.error(JSON.stringify({
      level: "error",
      source: "ancillary_cases_backfill",
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);
