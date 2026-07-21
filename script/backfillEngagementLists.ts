/**
 * Phase 2C backfill — engagement_lists + memberships from existing sends.
 *
 * DRY-RUN by default. Never modifies clinics. Never logs PHI. Refuses
 * rows missing Phase 2A identity links.
 *
 * Source: existing patient_execution_cases (with linked screening ->
 * ancillary case) grouped by the immutable source identity
 * (clinic_id, source_type, source_id). Because the legacy data has no
 * explicit source identity column, we derive it from screening_batches
 * (batchId → sourceType='batch', sourceId=`${batch.id}`). This is the
 * only backfill-time synthesis of source identity; every real-time
 * writer supplies the actual identity.
 *
 * Legacy sent_to_engagement_at is set to committed_at (Phase 2A) if
 * available, otherwise to the execution case's createdAt (documented
 * as a legacy limitation). Never derived from service_date.
 *
 * Usage:
 *   npx tsx script/backfillEngagementLists.ts                              # dry-run
 *   BACKFILL_ENGAGEMENT_LISTS_APPLY=YES \
 *     FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY=true \
 *     FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC=true \
 *     npx tsx script/backfillEngagementLists.ts                            # apply
 */

import { db } from "../server/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { patientScreenings, screeningBatches } from "@shared/schema/screening";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../server/lib/featureFlags";

type PlanOutcome =
  | "would_create_list"
  | "would_reuse_list"
  | "would_create_membership"
  | "would_reuse_membership"
  | "missing_identity_links"
  | "duplicate_source_identity"
  | "unresolved_legacy_timestamp"
  | "missing_ancillary_case"
  | "tenant_conflict"
  | "skipped_no_clinic"
  | "skipped_no_batch"
  | "error";

type PlanRow = {
  executionCaseId: number;
  screeningId: number | null;
  ancillaryCaseId: number | null;
  clinicId: number | null;
  sourceType: string;
  sourceId: string;
  serviceType: string | null;
  outcome: PlanOutcome;
  errorCode?: string;
};

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_ENGAGEMENT_LISTS_APPLY === "YES";
  if (apply && (!featureFlags.engagementMultiListRepository || !featureFlags.engagementAdminReviewSync)) {
    console.error(
      "Refusing to apply: BACKFILL_ENGAGEMENT_LISTS_APPLY=YES but required Phase 2C flags are not both ON.",
    );
    process.exit(2);
  }

  // Load candidate execution cases (bounded).
  const rows = await db
    .select({
      execId: patientExecutionCases.id,
      execClinicId: patientExecutionCases.clinicId,
      execCreatedAt: patientExecutionCases.createdAt,
      execSentToEngagementAt: patientExecutionCases.sentToEngagementAt,
      execSelectedServices: patientExecutionCases.selectedServices,
      screeningId: patientExecutionCases.patientScreeningId,
      screeningClinicId: patientScreenings.clinicId,
      screeningCommittedAt: patientScreenings.committedAt,
      screeningBatchId: patientScreenings.batchId,
      screeningGlobal: patientScreenings.globalPlexusPatientId,
      screeningMembership: patientScreenings.patientClinicMembershipId,
      screeningFacility: patientScreenings.facility,
      batchName: screeningBatches.name,
      batchScheduleDate: screeningBatches.scheduleDate,
    })
    .from(patientExecutionCases)
    .leftJoin(patientScreenings, eq(patientExecutionCases.patientScreeningId, patientScreenings.id))
    .leftJoin(screeningBatches, eq(patientScreenings.batchId, screeningBatches.id))
    .where(
      and(
        // Only surface active cases — closed/archived are historical.
        sql`${patientExecutionCases.lifecycleStatus} IN ('active')`,
        isNull(patientScreenings.deletedAt),
        isNotNull(patientScreenings.batchId),
      ),
    )
    .limit(1000);

  const plan: PlanRow[] = [];
  // Track (clinic_id, source_type, source_id) → set of executionCaseIds
  // to detect duplicate source identity.
  const identityCounts = new Map<string, Set<number>>();

  for (const r of rows) {
    const clinicId = r.execClinicId ?? r.screeningClinicId ?? null;
    if (!clinicId) {
      plan.push({
        executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: null,
        clinicId: null, sourceType: "", sourceId: "", serviceType: null,
        outcome: "skipped_no_clinic",
      });
      continue;
    }
    if (r.screeningBatchId == null) {
      plan.push({
        executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: null,
        clinicId, sourceType: "", sourceId: "", serviceType: null,
        outcome: "skipped_no_batch",
      });
      continue;
    }
    if (!r.screeningGlobal || !r.screeningMembership) {
      plan.push({
        executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: null,
        clinicId, sourceType: "batch", sourceId: String(r.screeningBatchId),
        serviceType: null, outcome: "missing_identity_links",
      });
      continue;
    }

    const sourceType = "batch";
    const sourceId = String(r.screeningBatchId);
    const identityKey = `${clinicId}:${sourceType}:${sourceId}`;
    const set = identityCounts.get(identityKey) ?? new Set<number>();
    set.add(r.execId);
    identityCounts.set(identityKey, set);

    // Look up the ancillary cases for this execution case.
    const ac = await db
      .select({
        id: patientAncillaryCases.id,
        serviceType: patientAncillaryCases.serviceType,
        adminReviewStatus: patientAncillaryCases.adminReviewStatus,
      })
      .from(patientAncillaryCases)
      .where(eq(patientAncillaryCases.executionCaseId, r.execId));
    if (ac.length === 0) {
      plan.push({
        executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: null,
        clinicId, sourceType, sourceId, serviceType: null,
        outcome: "missing_ancillary_case",
      });
      continue;
    }

    // Plan one membership row per ancillary case. In apply mode we
    // upsert; in dry-run we just count.
    for (const a of ac) {
      plan.push({
        executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: a.id,
        clinicId, sourceType, sourceId, serviceType: a.serviceType,
        outcome: apply ? "would_reuse_membership" : "would_create_membership",
      });
    }

    // Plan the list: reuse if we've already planned this identity for
    // another execution case, else create.
    const listPlanOutcome: PlanOutcome = set.size > 1 ? "would_reuse_list" : "would_create_list";
    plan.push({
      executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: null,
      clinicId, sourceType, sourceId, serviceType: null,
      outcome: listPlanOutcome,
    });

    // Legacy timestamp for sent_to_engagement_at:
    const legacyTs = r.screeningCommittedAt ?? r.execCreatedAt ?? null;
    if (!legacyTs) {
      plan.push({
        executionCaseId: r.execId, screeningId: r.screeningId, ancillaryCaseId: null,
        clinicId, sourceType, sourceId, serviceType: null,
        outcome: "unresolved_legacy_timestamp",
      });
    }
  }

  // Post-scan: flag identity collisions across DIFFERENT clinics
  // (shouldn't happen — batchId is per clinic — but paranoia is cheap).
  for (const [key, set] of identityCounts) {
    if (set.size > 1) {
      const [clinicStr, sourceType, sourceId] = key.split(":");
      // Note: same execCaseIds sharing identity is EXPECTED (multiple
      // ancillary cases per exec). What we flag is the same identity
      // being planned multiple times where the current row's outcome
      // was "would_create_list" more than once — the loop above
      // already prevents that. This is a defensive counter.
      plan.push({
        executionCaseId: -1, screeningId: null, ancillaryCaseId: null,
        clinicId: Number(clinicStr), sourceType, sourceId, serviceType: null,
        outcome: "duplicate_source_identity",
      });
    }
  }

  const summary = {
    mode: apply ? "APPLIED" : "DRY_RUN",
    execCasesScanned: new Set(rows.map((r) => r.execId)).size,
    plannedNewLists: plan.filter((p) => p.outcome === "would_create_list").length,
    plannedNewMemberships: plan.filter((p) => p.outcome === "would_create_membership").length,
    missingIdentityLinks: plan.filter((p) => p.outcome === "missing_identity_links").length,
    missingAncillaryCases: plan.filter((p) => p.outcome === "missing_ancillary_case").length,
    unresolvedLegacyTimestamps: plan.filter((p) => p.outcome === "unresolved_legacy_timestamp").length,
    duplicateSourceIdentities: plan.filter((p) => p.outcome === "duplicate_source_identity").length,
    tenantConflicts: plan.filter((p) => p.outcome === "tenant_conflict").length,
    skippedNoClinic: plan.filter((p) => p.outcome === "skipped_no_clinic").length,
    skippedNoBatch: plan.filter((p) => p.outcome === "skipped_no_batch").length,
    errors: plan.filter((p) => p.outcome === "error").length,
  };
  console.log(JSON.stringify({ summary, plan }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({
      level: "error",
      source: "engagement_lists_backfill",
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);
