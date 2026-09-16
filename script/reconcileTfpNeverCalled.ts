/**
 * READ-ONLY reconciliation — TFP never-called cohort (1,834) vs the current
 * remediated/approved rollout (1,816 = 35 assigned + 1,781 unassigned).
 *
 * Goal: identify EXACTLY what the 18 extra never-called TFP cases represent,
 * report their aggregate provenance (NO PHI), verify they are not duplicates of
 * the 1,816, and classify them operationally.
 *
 * SAFETY: this script performs ZERO writes. It only SELECTs. It reuses the
 * production cohort query (countCohort / listCohortCasesForDistribution) so the
 * never-called total matches what Engagement actually shows.
 *
 * Usage:  set -a; source .env; set +a; npx tsx script/reconcileTfpNeverCalled.ts
 */

import { db, pool } from "../server/db";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import {
  patientExecutionCases,
  patientScreenings,
  screeningBatches,
  callListPackageMembers,
} from "@shared/schema";
import {
  countCohort,
  filterCallableExecutionCaseIds,
} from "../server/services/engagement/callListCohortService";

const FACILITY = "Taylor Family Practice";
const REMEDIATION_IMPORT_JOB = 124; // Option-B remediation source (per remediateTfpIdentity.ts)
const TFP_CLINIC_ID = 1;

// Tiny helpers ---------------------------------------------------------------
type Counter = Map<string, number>;
const bump = (m: Counter, k: string | number | null | undefined, by = 1) => {
  const key = k == null ? "∅(null)" : String(k);
  m.set(key, (m.get(key) ?? 0) + by);
};
const obj = (m: Counter) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
const dateRange = (ds: (Date | null | undefined)[]) => {
  const t = ds.filter((d): d is Date => d instanceof Date && !isNaN(d.getTime())).map((d) => d.getTime());
  if (t.length === 0) return { min: null, max: null };
  return { min: new Date(Math.min(...t)).toISOString(), max: new Date(Math.max(...t)).toISOString() };
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[reconcile:tfp-never-called] DATABASE_URL is not set");
    process.exit(1);
  }

  // ── A. never_called = ? (exact production cohort query) ──────────────────
  // countCohort gives the authoritative total (1,834). The production list
  // helper is clamped to MAX_PREVIEW_LIMIT=200, so to enumerate the FULL
  // population we (1) select every TFP execution case with NO outreach ever
  // (the cohort scope + noOutreachEver predicate, verbatim), then (2) apply the
  // EXACT production callable baseline gate via filterCallableExecutionCaseIds.
  const neverCalledTotal = await countCohort({ cohort: "never_called", facility: FACILITY });

  const scopeRows = await db.execute<{ id: number }>(sql`
    SELECT ec.id
    FROM patient_execution_cases ec
    WHERE ec.facility_id = ${FACILITY}
      AND NOT EXISTS (
        SELECT 1 FROM outreach_calls oc
        WHERE oc.patient_screening_id = ec.patient_screening_id
      )
  `);
  const scopeIds = (scopeRows.rows ?? []).map((r) => Number(r.id));
  const callableSet = await filterCallableExecutionCaseIds(scopeIds);
  const cohortIds = scopeIds.filter((id) => callableSet.has(id));

  // Full execution-case rows for the cohort (assignment + provenance).
  const ecRows = cohortIds.length
    ? await db.select().from(patientExecutionCases).where(inArray(patientExecutionCases.id, cohortIds))
    : [];

  const screeningIds = Array.from(
    new Set(ecRows.map((r) => r.patientScreeningId).filter((n): n is number => n != null)),
  );
  const screenings = screeningIds.length
    ? await db.select().from(patientScreenings).where(inArray(patientScreenings.id, screeningIds))
    : [];
  const scrById = new Map(screenings.map((s) => [s.id, s]));

  const batchIds = Array.from(
    new Set(screenings.map((s) => s.batchId).filter((n): n is number => n != null)),
  );
  const batches = batchIds.length
    ? await db.select().from(screeningBatches).where(inArray(screeningBatches.id, batchIds))
    : [];
  const batchById = new Map(batches.map((b) => [b.id, b]));

  // ── Assignment split across the WHOLE never-called cohort ────────────────
  const assignedAll = ecRows.filter((r) => r.assignedTeamMemberId != null).length;
  const unassignedAll = ecRows.length - assignedAll;

  // ── Define the remediated/approved rollout membership per case ───────────
  // A case belongs to the remediated Option-B rollout when its screening came
  // from the remediation import job AND has a canonical identity (the exact
  // population remediateTfpIdentity.ts targeted). We ALSO compute simpler
  // discriminators so the natural 1,816/18 split is visible, not assumed.
  type Tag = {
    ec: typeof patientExecutionCases.$inferSelect;
    scr?: typeof patientScreenings.$inferSelect;
    batch?: typeof screeningBatches.$inferSelect;
  };
  const tagged: Tag[] = ecRows.map((ec) => {
    const scr = ec.patientScreeningId != null ? scrById.get(ec.patientScreeningId) : undefined;
    const batch = scr?.batchId != null ? batchById.get(scr.batchId) : undefined;
    return { ec, scr, batch };
  });

  const isRemediated = (t: Tag) =>
    t.scr?.importJobId === REMEDIATION_IMPORT_JOB &&
    t.scr?.globalPlexusPatientId != null &&
    t.scr?.patientClinicMembershipId != null &&
    t.scr?.clinicId === TFP_CLINIC_ID;

  const rollout = tagged.filter(isRemediated);
  const extras = tagged.filter((t) => !isRemediated(t));

  // Rollout assignment forensics — explain any assigned/unassigned drift and
  // whether assignment came from a frozen call-list package (distribution).
  const rolloutAssigned = rollout.filter((t) => t.ec.assignedTeamMemberId != null);
  const rolloutEcIds = rollout.map((t) => t.ec.id);
  const rolloutPkgRows = rolloutEcIds.length
    ? await db
        .select({ ec: callListPackageMembers.executionCaseId })
        .from(callListPackageMembers)
        .where(inArray(callListPackageMembers.executionCaseId, rolloutEcIds))
    : [];
  const rolloutInPkg = new Set(rolloutPkgRows.map((r) => r.ec));
  const rolloutForensics = {
    assigned: rolloutAssigned.length,
    unassigned: rollout.length - rolloutAssigned.length,
    distinctAssignedTeamMembers: new Set(rolloutAssigned.map((t) => t.ec.assignedTeamMemberId)).size,
    assignedAndInCallListPackage: rolloutAssigned.filter((t) => rolloutInPkg.has(t.ec.id)).length,
    assignedButNotInPackage: rolloutAssigned.filter((t) => !rolloutInPkg.has(t.ec.id)).length,
    bySourceType: (() => {
      const m: Counter = new Map();
      for (const t of rollout) bump(m, t.scr?.sourceType);
      return obj(m);
    })(),
    byExecutionCaseSource: (() => {
      const m: Counter = new Map();
      for (const t of rollout) bump(m, t.ec.source);
      return obj(m);
    })(),
  };

  // Cross-tabs over the WHOLE cohort so the discriminator is transparent.
  const xtab = (pred: (t: Tag) => string | number | null | undefined) => {
    const m: Counter = new Map();
    for (const t of tagged) bump(m, pred(t));
    return obj(m);
  };

  // ── D. Provenance of the extras (aggregate only, NO PHI) ─────────────────
  const extraBatch: Counter = new Map();
  const extraImportJob: Counter = new Map();
  const extraSourceType: Counter = new Map();
  const extraApproval: Counter = new Map();
  const extraCommit: Counter = new Map();
  const extraLifecycle: Counter = new Map();
  const extraEngagement: Counter = new Map();
  const extraAssign: Counter = new Map();
  const extraClinic: Counter = new Map();
  const extraExecSource: Counter = new Map();
  const extraScrIsTest: Counter = new Map();
  const extraBatchIsTest: Counter = new Map();
  const extraIdentity: Counter = new Map();
  for (const t of extras) {
    bump(extraBatch, t.batch ? `${t.batch.id}:${t.batch.name}` : "∅(no batch)");
    bump(extraImportJob, t.scr?.importJobId);
    bump(extraSourceType, t.scr?.sourceType);
    bump(extraApproval, t.scr?.adminApprovalStatus);
    bump(extraCommit, t.scr?.commitStatus);
    bump(extraLifecycle, t.ec.lifecycleStatus);
    bump(extraEngagement, t.ec.engagementStatus);
    bump(extraAssign, t.ec.assignedTeamMemberId == null ? "unassigned" : "assigned");
    bump(extraClinic, t.ec.clinicId);
    bump(extraExecSource, t.ec.source);
    bump(extraScrIsTest, t.scr?.isTest);
    bump(extraBatchIsTest, t.batch?.isTest);
    bump(
      extraIdentity,
      t.scr?.globalPlexusPatientId != null && t.scr?.patientClinicMembershipId != null
        ? "linked"
        : "unlinked",
    );
  }

  // ── E. Duplicate check: do any extras collide with the rollout on ────────
  // global_plexus_patient_id, patient_clinic_membership_id, or screening_id?
  const rolloutGpp = new Set(rollout.map((t) => t.scr?.globalPlexusPatientId).filter((n) => n != null));
  const rolloutPcm = new Set(rollout.map((t) => t.scr?.patientClinicMembershipId).filter((n) => n != null));
  const rolloutScr = new Set(rollout.map((t) => t.scr?.id).filter((n) => n != null));
  const dupGpp = extras.filter((t) => t.scr?.globalPlexusPatientId != null && rolloutGpp.has(t.scr.globalPlexusPatientId)).length;
  const dupPcm = extras.filter((t) => t.scr?.patientClinicMembershipId != null && rolloutPcm.has(t.scr.patientClinicMembershipId)).length;
  const dupScr = extras.filter((t) => t.scr?.id != null && rolloutScr.has(t.scr.id)).length;

  // ── Package membership + outreach history for the extras (provenance) ────
  const extraEcIds = extras.map((t) => t.ec.id);
  const extraScrIds = extras.map((t) => t.scr?.id).filter((n): n is number => n != null);

  const pkgRows = extraEcIds.length
    ? await db
        .select({ ec: callListPackageMembers.executionCaseId })
        .from(callListPackageMembers)
        .where(inArray(callListPackageMembers.executionCaseId, extraEcIds))
    : [];
  const extrasInPackage = new Set(pkgRows.map((r) => r.ec)).size;

  // Outreach history — must be 0 for a never-called cohort (sanity check).
  const outreachRows = extraScrIds.length
    ? await db.execute<{ patient_screening_id: number; n: number }>(sql`
        SELECT patient_screening_id, count(*)::int AS n
        FROM outreach_calls
        WHERE patient_screening_id IN (${sql.join(extraScrIds.map((n) => sql`${n}`), sql`, `)})
        GROUP BY patient_screening_id
      `)
    : ({ rows: [] } as { rows: { patient_screening_id: number; n: number }[] });
  const extrasWithOutreach = (outreachRows.rows ?? []).length;

  // QA / canary / test signals among the extras.
  const testGuyScreening = extras.some((t) => t.scr?.id === 3); // known TestGuy fixture
  const outlierScreening50 = extras.some((t) => t.scr?.id === 50); // remediation manual-hold outlier
  const qaNameHits = extras.filter((t) => /test|qa|canary|robot|demo|dummy|sample/i.test(t.batch?.name ?? "")).length;

  // ── F. Operational classification of each extra (aggregate buckets) ──────
  // Deterministic, evidence-based bucketing. Priority order matters: a row is
  // classified by its STRONGEST signal.
  const classify = (t: Tag): string => {
    if (t.scr?.id === 50) return "OUTLIER_MANUAL_REVIEW (remediation hold)";
    if (t.scr?.isTest === true || t.batch?.isTest === true) return "LEGACY_TEST (is_test flag)";
    if (t.ec.source === "demo_seed" || /^demo_/i.test(t.batch?.name ?? "")) return "QA_CANARY (demo seed)";
    if (/\bqa\b|validation|canary|phase\s*\d/i.test(t.batch?.name ?? "")) return "QA_CANARY (qa/validation batch)";
    if (!t.batch) return "OTHER (no batch / orphan)";
    // Approved, not test, real-looking TFP/EHR batch, outside the remediation import.
    if (t.scr?.adminApprovalStatus === "approved") return "LEGITIMATE_EXISTING_TFP (non-import-124 onboarding)";
    return "OTHER (unapproved / indeterminate)";
  };
  const extraClassification: Counter = new Map();
  for (const t of extras) bump(extraClassification, classify(t));

  // ── Report ───────────────────────────────────────────────────────────────
  const report = {
    facility: FACILITY,
    A_neverCalled: {
      total: neverCalledTotal,
      fullPopulationEnumerated: cohortIds.length,
      matchesCountCohort: cohortIds.length === neverCalledTotal,
      executionCaseRowsResolved: ecRows.length,
      note: "Engagement never_called = execution cases at facility passing the callable baseline gate with NO outreach_calls ever.",
    },
    B_currentRollout_remediatedOptionB: {
      total: rollout.length,
      assigned: rollout.filter((t) => t.ec.assignedTeamMemberId != null).length,
      unassigned: rollout.filter((t) => t.ec.assignedTeamMemberId == null).length,
      definition: `screening.importJobId=${REMEDIATION_IMPORT_JOB} AND clinic_id=${TFP_CLINIC_ID} AND global+membership linked`,
    },
    B_rolloutAssignmentForensics: rolloutForensics,
    B_wholeCohortAssignmentSplit: { assigned: assignedAll, unassigned: unassignedAll, total: ecRows.length },
    C_extraCaseCount: extras.length,
    D_extrasProvenance: {
      byBatch: obj(extraBatch),
      byImportJob: obj(extraImportJob),
      bySourceType: obj(extraSourceType),
      byAdminApprovalStatus: obj(extraApproval),
      byCommitStatus: obj(extraCommit),
      byExecutionLifecycleStatus: obj(extraLifecycle),
      byEngagementStatus: obj(extraEngagement),
      byAssignmentStatus: obj(extraAssign),
      byClinicId: obj(extraClinic),
      byExecutionCaseSource: obj(extraExecSource),
      screeningIsTest: obj(extraScrIsTest),
      batchIsTest: obj(extraBatchIsTest),
      canonicalIdentity: obj(extraIdentity),
      createdDateRange_executionCase: dateRange(extras.map((t) => t.ec.createdAt as unknown as Date)),
      createdDateRange_screening: dateRange(extras.map((t) => (t.scr?.createdAt as unknown as Date) ?? null)),
      inCallListPackage: extrasInPackage,
      withOutreachHistory: extrasWithOutreach,
      priorQaCanarySignals: {
        testGuyScreeningId3Present: testGuyScreening,
        remediationOutlierScreeningId50Present: outlierScreening50,
        batchNameQaTestCanaryHits: qaNameHits,
      },
    },
    E_duplicateCheckAgainstRollout: {
      byGlobalPlexusPatientId: dupGpp,
      byPatientClinicMembershipId: dupPcm,
      byScreeningId: dupScr,
      anyDuplicates: dupGpp > 0 || dupPcm > 0 || dupScr > 0,
    },
    F_operationalClassification: obj(extraClassification),
    wholeCohortCrossTabs: {
      byImportJob: xtab((t) => t.scr?.importJobId),
      byClinicId: xtab((t) => t.ec.clinicId),
      byAdminApprovalStatus: xtab((t) => t.scr?.adminApprovalStatus),
      canonicalIdentityLinked: xtab((t) =>
        t.scr?.globalPlexusPatientId != null && t.scr?.patientClinicMembershipId != null ? "linked" : "unlinked",
      ),
      screeningIsTest: xtab((t) => t.scr?.isTest),
    },
    arithmeticCheck: {
      rolloutPlusExtras: rollout.length + extras.length,
      equalsNeverCalled: rollout.length + extras.length === neverCalledTotal,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({ level: "error", source: "reconcile_tfp_never_called", message: (err as Error)?.message ?? String(err) }));
    process.exit(1);
  },
);
