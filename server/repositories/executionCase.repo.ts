import { db } from "../db";
import { eq, and, desc, sql, inArray, notInArray, isNull } from "drizzle-orm";
import { publishLiveActivity } from "../services/engagement/liveActivityBus";
import {
  patientExecutionCases,
  patientJourneyEvents,
  type PatientExecutionCase,
  type PatientJourneyEvent,
  type InsertPatientJourneyEvent,
} from "@shared/schema/executionCase";
import { insuranceEligibilityReviews } from "@shared/schema/insuranceEligibility";
import type { PatientScreening } from "@shared/schema/screening";
import {
  getEngagementCenterDefaults,
  getInsurancePriorityDefaults,
  type EngagementCenterDefaults,
  type InsurancePriorityWeights,
} from "./adminSettings.repo";
// Phase 2B — canonical ancillary-case reconciliation. No-op when
// FEATURE_ANCILLARY_CASE_WRITE is OFF (default). Called after the
// execution-case sync so every selected service ensures its
// corresponding canonical ancillary case exists.
import {
  reconcileAncillaryCasesBulk,
  conservativelyRemoveAncillaryService,
} from "../services/ancillaryCases/reconciliation";
import type { ReconcileInput } from "../services/ancillaryCases/reconciliation";
import type { AncillaryAdminReviewStatus, AncillaryQualificationStatus } from "@shared/schema/ancillaryCases";

// ─── Settings-driven priority scoring ──────────────────────────────────────

const TERMINAL_LIFECYCLE_STATUSES = ["closed", "inactive", "archived"] as const;
const TERMINAL_ENGAGEMENT_STATUSES = ["completed", "closed"] as const;

export type EngagementPriorityContext = {
  bucketWeights: Record<string, number>;
  insuranceWeights: InsurancePriorityWeights;
  insurancePriorityByScreening: Map<number, string>;
  nextActionWindowMinutes: number;
};

/** Compute a settings-driven priority score for a single execution case.
 *  Higher = surface earlier. Combines bucket weight, insurance class,
 *  qualification, explicit priorityScore column, and next-action proximity.
 *  This is a pure function; the caller owns DB I/O and bulk fetches. */
export function calculateEngagementCasePriority(
  caseRow: PatientExecutionCase,
  context: EngagementPriorityContext,
): number {
  let score = 0;

  // Bucket weight (visit > scheduling_triage > outreach by default)
  score += (context.bucketWeights[caseRow.engagementBucket ?? ""] ?? 0) * 100;

  // Insurance priority — looked up by patientScreeningId via the bulk map
  if (caseRow.patientScreeningId != null) {
    const klass = context.insurancePriorityByScreening.get(caseRow.patientScreeningId);
    if (klass) {
      const w = (context.insuranceWeights as Record<string, number>)[klass] ?? 0;
      score += w * 30;
    }
  }

  // Qualification
  if (caseRow.qualificationStatus === "qualified") score += 50;

  // Explicit priorityScore column gives a baseline boost
  if (typeof caseRow.priorityScore === "number" && Number.isFinite(caseRow.priorityScore)) {
    score += caseRow.priorityScore;
  }

  // Next-action proximity — overdue or within window gets a boost
  if (caseRow.nextActionAt) {
    const dt = caseRow.nextActionAt instanceof Date
      ? caseRow.nextActionAt
      : new Date(caseRow.nextActionAt as unknown as string);
    const t = dt.getTime();
    if (Number.isFinite(t)) {
      const minutesUntil = (t - Date.now()) / 60_000;
      if (minutesUntil <= 0) score += 200;          // overdue
      else if (minutesUntil < context.nextActionWindowMinutes) score += 100;
      else score += Math.max(0, 50 - Math.floor(minutesUntil / 60));
    }
  }

  return score;
}

/** Bulk-fetch insurance priorityClass per patientScreeningId. Used to
 *  populate the priority context without N+1 lookups during ranking. */
async function bulkInsurancePriorityByScreening(
  screeningIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (screeningIds.length === 0) return out;
  const rows = await db
    .select({
      psid: insuranceEligibilityReviews.patientScreeningId,
      pc: insuranceEligibilityReviews.priorityClass,
    })
    .from(insuranceEligibilityReviews)
    .where(inArray(insuranceEligibilityReviews.patientScreeningId, screeningIds));
  for (const r of rows) {
    if (r.psid != null && r.pc) out.set(r.psid, r.pc);
  }
  return out;
}

/** Build the priority context (bucket weights, insurance weights, screening
 *  → priorityClass map, next-action window) by reading admin_settings + the
 *  insurance reviews for the caller-supplied screeningIds. */
async function buildEngagementPriorityContext(
  screeningIds: number[],
  defaults?: EngagementCenterDefaults,
): Promise<EngagementPriorityContext> {
  const [defs, insuranceWeights, insuranceMap] = await Promise.all([
    defaults ? Promise.resolve(defaults) : getEngagementCenterDefaults(),
    getInsurancePriorityDefaults(),
    bulkInsurancePriorityByScreening(screeningIds),
  ]);
  return {
    bucketWeights: defs.bucketWeights,
    insuranceWeights,
    insurancePriorityByScreening: insuranceMap,
    nextActionWindowMinutes: defs.nextActionWindowMinutes,
  };
}

/** Stable comparator implementing the spec sort order:
 *    1. priorityScore DESC NULLS LAST (column)
 *    2. calculated priority DESC (settings-driven)
 *    3. nextActionAt ASC NULLS LAST
 *    4. createdAt DESC */
function sortByEngagementPriority<T extends PatientExecutionCase>(
  rows: T[],
  scores: Map<number, number>,
): T[] {
  const list = [...rows];
  list.sort((a, b) => {
    const aPS = a.priorityScore ?? Number.NEGATIVE_INFINITY;
    const bPS = b.priorityScore ?? Number.NEGATIVE_INFINITY;
    if (aPS !== bPS) return bPS - aPS;

    const aCalc = scores.get(a.id) ?? 0;
    const bCalc = scores.get(b.id) ?? 0;
    if (aCalc !== bCalc) return bCalc - aCalc;

    const aNAA = a.nextActionAt ? new Date(a.nextActionAt as unknown as string).getTime() : Number.POSITIVE_INFINITY;
    const bNAA = b.nextActionAt ? new Date(b.nextActionAt as unknown as string).getTime() : Number.POSITIVE_INFINITY;
    if (aNAA !== bNAA) return aNAA - bNAA;

    const aCA = a.createdAt ? new Date(a.createdAt as unknown as string).getTime() : 0;
    const bCA = b.createdAt ? new Date(b.createdAt as unknown as string).getTime() : 0;
    return bCA - aCA;
  });
  return list;
}

function deriveEngagementBucket(screening: PatientScreening): "visit" | "outreach" | "scheduling_triage" {
  const t = (screening.patientType ?? "visit").toLowerCase();
  if (t === "outreach") return "outreach";
  if (t === "visit") return "visit";
  return "scheduling_triage";
}

function deriveQualificationStatus(screening: PatientScreening): "qualified" | "not_qualified" | "unscreened" {
  const tests = screening.qualifyingTests ?? [];
  if (screening.status === "completed") {
    return tests.length > 0 ? "qualified" : "not_qualified";
  }
  return "unscreened";
}

export async function createOrUpdateExecutionCaseFromScreening(
  screening: PatientScreening,
  actorUserId: string | null,
): Promise<{ executionCase: PatientExecutionCase; created: boolean }> {
  const [existing] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, screening.id))
    .limit(1);

  const engagementBucket = deriveEngagementBucket(screening);
  const qualificationStatus = deriveQualificationStatus(screening);
  const selectedServices = Array.isArray(screening.qualifyingTests) && screening.qualifyingTests.length > 0
    ? (screening.qualifyingTests as string[])
    : undefined;

  if (existing) {
    const [updated] = await db
      .update(patientExecutionCases)
      .set({
        patientName: screening.name,
        patientDob: screening.dob ?? undefined,
        facilityId: screening.facility ?? undefined,
        engagementBucket,
        qualificationStatus,
        selectedServices,
        updatedAt: new Date(),
      })
      .where(eq(patientExecutionCases.id, existing.id))
      .returning();

    await syncAncillaryCasesFromScreening({
      screening,
      executionCaseId: updated.id,
      actorUserId,
      selectedServices: selectedServices ?? [],
      source: "execution_case_updated",
    });

    return { executionCase: updated, created: false };
  }

  const [created] = await db
    .insert(patientExecutionCases)
    .values({
      patientScreeningId: screening.id,
      patientName: screening.name,
      patientDob: screening.dob ?? undefined,
      facilityId: screening.facility ?? undefined,
      source: "system_generated",
      engagementBucket,
      qualificationStatus,
      lifecycleStatus: "active",
      engagementStatus: "new",
      selectedServices,
    })
    .returning();

  await syncAncillaryCasesFromScreening({
    screening,
    executionCaseId: created.id,
    actorUserId,
    selectedServices: selectedServices ?? [],
    source: "execution_case_created",
  });

  return { executionCase: created, created: true };
}

/**
 * Phase 2B — one-way sync from a committed screening's selected
 * services to canonical `patient_ancillary_cases` rows.
 *
 * Behavior:
 *   • Flag OFF → returns immediately (zero DB touches).
 *   • Missing Phase 2A identity links → returns silently; the
 *     reconciler emits an audit event describing the skip.
 *   • For every selected service → ensure an active ancillary case
 *     exists (create or reuse) via the shared reconciler.
 *   • For every ACTIVE case whose service is no longer selected →
 *     conservative removal (default: on_hold; no hard delete).
 */
async function syncAncillaryCasesFromScreening(args: {
  screening: PatientScreening;
  executionCaseId: number | null;
  actorUserId: string | null;
  selectedServices: string[];
  source: string;
}): Promise<void> {
  const { screening, executionCaseId, actorUserId, selectedServices, source } = args;
  const clinicId = screening.clinicId ?? null;
  const globalPlexusPatientId = screening.globalPlexusPatientId ?? null;
  const patientClinicMembershipId = screening.patientClinicMembershipId ?? null;

  // These checks let the sync be a hard-safe no-op when Phase 2A
  // hasn't been applied / backfilled. The reconciler itself would
  // return `missing_identity_links`, but we prefer to skip audit-event
  // noise when the ids are trivially null.
  if (!clinicId || !globalPlexusPatientId || !patientClinicMembershipId) return;

  const qualificationStatus: AncillaryQualificationStatus =
    (screening as { qualifyingTests?: string[] | null }).qualifyingTests?.length
      ? "qualified"
      : "unscreened";
  const adminReviewStatus: AncillaryAdminReviewStatus =
    (screening as { adminApprovalStatus?: string }).adminApprovalStatus === "approved"
      ? "approved"
      : "pending";

  const inputs: ReconcileInput[] = selectedServices.map((serviceType) => ({
    clinicId,
    globalPlexusPatientId,
    patientClinicMembershipId,
    originatingScreeningId: screening.id,
    executionCaseId,
    serviceType,
    qualificationStatus,
    adminReviewStatus,
    source,
    actorUserId,
    patientNameForAudit: screening.name,
    patientDobForAudit: screening.dob ?? null,
  }));
  const bulk = await reconcileAncillaryCasesBulk(inputs);
  for (const err of bulk.errors) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "error",
      source: "ancillary_case_sync",
      site: "createOrUpdateExecutionCaseFromScreening",
      screeningId: screening.id,
      serviceType: err.serviceType,
      code: err.code,
      message: err.message,
    }));
  }

  // Conservative removal: any currently-active case whose serviceType
  // is not in the current selected list is placed on_hold. We compute
  // this against the projection helper's underlying source (active
  // cases for the same patient + clinic).
  const currentActiveServiceTypes = new Set(
    bulk.ok
      .filter((r) => r.status === "reused" || r.status === "created")
      .map((r) => (r as { serviceType: string }).serviceType),
  );
  // Find any active cases NOT re-selected this round. We can't derive
  // them from bulk.ok alone — we need a fresh read of active cases.
  const active = await import("../repositories/ancillaryCases.repo").then((m) =>
    m.listAncillaryCasesForPatient(globalPlexusPatientId),
  );
  const droppedServiceTypes = active
    .filter(
      (a) =>
        a.clinicId === clinicId &&
        !currentActiveServiceTypes.has(a.serviceType) &&
        (a.lifecycleStatus === "new" ||
          a.lifecycleStatus === "active" ||
          a.lifecycleStatus === "on_hold"),
    )
    .map((a) => a.serviceType);
  for (const st of droppedServiceTypes) {
    await conservativelyRemoveAncillaryService({
      clinicId,
      globalPlexusPatientId,
      serviceType: st,
      action: "on_hold",
      source,
      actorUserId,
      patientNameForAudit: screening.name,
      patientDobForAudit: screening.dob ?? null,
    });
  }
}

export async function appendPatientJourneyEvent(
  event: InsertPatientJourneyEvent,
): Promise<PatientJourneyEvent> {
  const [result] = await db
    .insert(patientJourneyEvents)
    .values(event)
    .returning();
  // Push a non-PHI signal so live SSE consumers (Engagement Live Team Activity)
  // can refetch within ~1s instead of waiting on the polling tick.
  publishLiveActivity(result.eventType);
  return result;
}

export type ListExecutionCasesFilters = {
  engagementBucket?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  facilityId?: string;
  patientScreeningId?: number;
};

export async function listExecutionCases(
  filters: ListExecutionCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];
  if (filters.engagementBucket) conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  if (filters.lifecycleStatus) conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  if (filters.engagementStatus) conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  if (filters.facilityId) conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  if (filters.patientScreeningId != null) conditions.push(eq(patientExecutionCases.patientScreeningId, filters.patientScreeningId));

  const query = db.select().from(patientExecutionCases)
    .$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(patientExecutionCases.createdAt)).limit(safeLimit)
    : query.orderBy(desc(patientExecutionCases.createdAt)).limit(safeLimit);
}

// Normalizes a patient name for identity comparison: trims, collapses
// internal whitespace runs, and lowercases. "  Jon  Smith " → "jon smith".
export function normalizePatientName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Looks up an existing QUICK-SCHEDULE STUB case so double-submits of the
// same name-only patient reuse one stub instead of spawning duplicates.
// Deliberately narrow to avoid hijacking an unrelated patient's case:
// - only cases created by quick-schedule (source='quick_schedule')
// - patientName match is case/whitespace-insensitive (trim + collapse
//   internal whitespace + lower) so "jon smith " reuses "Jon Smith"
// - exact patientDob (DOB is required — without it a common-name
//   collision could cross-link operational data)
// - same facility (both null counts as a match)
export async function getQuickScheduleStubCase(
  patientName: string,
  patientDob: string,
  facilityId: string | null,
): Promise<PatientExecutionCase | undefined> {
  const normalized = normalizePatientName(patientName);
  const conditions = [
    eq(patientExecutionCases.source, "quick_schedule"),
    sql`lower(regexp_replace(trim(${patientExecutionCases.patientName}), '\\s+', ' ', 'g')) = ${normalized}`,
    eq(patientExecutionCases.patientDob, patientDob.trim()),
    facilityId === null
      ? isNull(patientExecutionCases.facilityId)
      : eq(patientExecutionCases.facilityId, facilityId),
  ];
  const [result] = await db
    .select()
    .from(patientExecutionCases)
    .where(and(...conditions))
    .orderBy(desc(patientExecutionCases.createdAt))
    .limit(1);
  return result;
}

// ─── Similar-patient lookup (duplicate-prevention aid) ─────────────────────

/** Levenshtein edit distance — small inputs (patient names) only. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

export type SimilarExecutionCaseMatch = {
  id: number;
  patientName: string;
  patientDob: string | null;
  facilityId: string | null;
  patientScreeningId: number | null;
  source: string;
  qualificationStatus: string;
  engagementStatus: string;
  createdAt: Date | null;
  matchReason: "exact_name" | "similar_name" | "same_dob_similar_name";
};

/** Finds existing execution cases that likely represent the same patient
 *  as the supplied name (+optional DOB). Used by the quick-schedule dialog
 *  to surface "did you mean this existing patient?" before creating a
 *  duplicate stub. Matching (against normalized names):
 *    - exact normalized name (case/whitespace-insensitive)
 *    - similar name: edit distance ≤ 2 (≤ 1 for short names)
 *    - same DOB + edit distance ≤ 4 (typos + DOB agreement = strong signal)
 *  Read-only ranking helper — never auto-links; the caller decides. */
export async function findSimilarExecutionCases(
  patientName: string,
  patientDob?: string | null,
  limit = 5,
): Promise<SimilarExecutionCaseMatch[]> {
  const target = normalizePatientName(patientName);
  if (!target) return [];
  const dob = (patientDob ?? "").trim() || null;

  // Candidate pool: recent non-archived cases. Names are compared in JS
  // (edit distance isn't expressible without pg_trgm/fuzzystrmatch).
  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(notInArray(patientExecutionCases.lifecycleStatus, [...TERMINAL_LIFECYCLE_STATUSES]))
    .orderBy(desc(patientExecutionCases.createdAt))
    .limit(1000);

  const scored: Array<{ row: PatientExecutionCase; reason: SimilarExecutionCaseMatch["matchReason"]; dist: number }> = [];
  for (const row of rows) {
    const candidate = normalizePatientName(row.patientName ?? "");
    if (!candidate) continue;
    const dist = levenshtein(target, candidate);
    const sameDob = dob !== null && (row.patientDob ?? "").trim() === dob;
    const shortName = Math.min(target.length, candidate.length) < 6;
    if (dist === 0) {
      scored.push({ row, reason: "exact_name", dist });
    } else if (sameDob && dist <= 4) {
      scored.push({ row, reason: "same_dob_similar_name", dist });
    } else if (dist <= (shortName ? 1 : 2)) {
      scored.push({ row, reason: "similar_name", dist });
    }
  }

  const reasonRank = { exact_name: 0, same_dob_similar_name: 1, similar_name: 2 } as const;
  scored.sort((a, b) => {
    if (reasonRank[a.reason] !== reasonRank[b.reason]) return reasonRank[a.reason] - reasonRank[b.reason];
    if (a.dist !== b.dist) return a.dist - b.dist;
    const aT = a.row.createdAt ? new Date(a.row.createdAt as unknown as string).getTime() : 0;
    const bT = b.row.createdAt ? new Date(b.row.createdAt as unknown as string).getTime() : 0;
    return bT - aT;
  });

  return scored.slice(0, Math.min(Math.max(1, limit), 20)).map(({ row, reason }) => ({
    id: row.id,
    patientName: row.patientName,
    patientDob: row.patientDob ?? null,
    facilityId: row.facilityId ?? null,
    patientScreeningId: row.patientScreeningId ?? null,
    source: row.source,
    qualificationStatus: row.qualificationStatus,
    engagementStatus: row.engagementStatus,
    createdAt: row.createdAt ?? null,
    matchReason: reason,
  }));
}

// Quick-schedule stub: creates a minimal execution case for a brand-new
// patient who has no screening yet (walk-in / not-yet-screened). The case
// is honest about its provenance (source=quick_schedule, unscreened) so
// downstream views can distinguish it from system-generated cases.
export async function createQuickScheduleExecutionCase(input: {
  patientName: string;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType?: string | null;
}): Promise<PatientExecutionCase> {
  const [created] = await db
    .insert(patientExecutionCases)
    .values({
      patientScreeningId: null,
      patientName: input.patientName,
      patientDob: input.patientDob ?? undefined,
      facilityId: input.facilityId ?? undefined,
      source: "quick_schedule",
      engagementBucket: "visit",
      qualificationStatus: "unscreened",
      lifecycleStatus: "active",
      engagementStatus: "new",
      selectedServices: input.serviceType ? [input.serviceType] : undefined,
    })
    .returning();
  return created;
}

export async function getExecutionCaseById(id: number): Promise<PatientExecutionCase | undefined> {
  const [result] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.id, id))
    .limit(1);
  return result;
}

export async function getExecutionCaseByScreeningId(screeningId: number): Promise<PatientExecutionCase | undefined> {
  const [result] = await db
    .select()
    .from(patientExecutionCases)
    .where(eq(patientExecutionCases.patientScreeningId, screeningId))
    .limit(1);
  return result;
}

export type ListEngagementCenterCasesFilters = {
  engagementBucket?: string;
  facilityId?: string;
  assignedTeamMemberId?: number;
  assignedRole?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  qualificationStatus?: string;
};

/** Engagement Center read: executes against patient_execution_cases.
 *  Default exclusions (when caller doesn't specify):
 *    lifecycleStatus NOT IN (closed, inactive, archived)
 *    engagementStatus NOT IN (completed, closed)
 *  After fetch, the rows are re-sorted in JS using the settings-driven
 *  priority comparator (bucket weight → insurance priority → next-action
 *  proximity → priorityScore column → createdAt). Returns up to safeLimit
 *  rows (default 100, max 500). */
export async function listEngagementCenterCases(
  filters: ListEngagementCenterCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];
  if (filters.engagementBucket) conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  if (filters.facilityId) conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  if (filters.assignedTeamMemberId != null) conditions.push(eq(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberId));
  if (filters.assignedRole) conditions.push(eq(patientExecutionCases.assignedRole, filters.assignedRole));
  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  if (filters.lifecycleStatus) {
    conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.lifecycleStatus, [...TERMINAL_LIFECYCLE_STATUSES]));
  }
  if (filters.engagementStatus) {
    conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.engagementStatus, [...TERMINAL_ENGAGEMENT_STATUSES]));
  }

  const query = db.select().from(patientExecutionCases).$dynamic();
  const orderClause = [
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  const rows = await query.where(and(...conditions)).orderBy(...orderClause).limit(safeLimit);

  // Settings-driven priority refinement (in JS — applied on top of the SQL
  // ordering so DB-side index access still wins for the initial slice).
  const screeningIds = rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null);
  const ctx = await buildEngagementPriorityContext(screeningIds);
  const scores = new Map<number, number>();
  for (const r of rows) scores.set(r.id, calculateEngagementCasePriority(r, ctx));
  return sortByEngagementPriority(rows, scores);
}

export type ListSchedulerPortalCasesFilters = {
  assignedTeamMemberId?: number;
  facilityId?: string;
  engagementBucket?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  qualificationStatus?: string;
};

const SCHEDULER_DEFAULT_BUCKETS = ["visit", "outreach", "scheduling_triage"] as const;
const SCHEDULER_TERMINAL_ENGAGEMENT_STATUSES = ["completed", "closed"] as const;

/** Scheduler Portal read: defaults to scheduler-relevant buckets and excludes
 *  terminal engagement statuses when caller does not override. Ordered by
 *  nextActionAt ASC NULLS LAST, priorityScore DESC NULLS LAST, createdAt DESC. */
export async function listSchedulerPortalCases(
  filters: ListSchedulerPortalCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.engagementBucket) {
    conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  } else {
    conditions.push(inArray(patientExecutionCases.engagementBucket, [...SCHEDULER_DEFAULT_BUCKETS]));
  }

  if (filters.engagementStatus) {
    conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.engagementStatus, [...SCHEDULER_TERMINAL_ENGAGEMENT_STATUSES]));
  }

  if (filters.assignedTeamMemberId != null) conditions.push(eq(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberId));
  if (filters.facilityId) conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  if (filters.lifecycleStatus) {
    conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  } else {
    conditions.push(notInArray(patientExecutionCases.lifecycleStatus, [...TERMINAL_LIFECYCLE_STATUSES]));
  }

  const query = db.select().from(patientExecutionCases).$dynamic();
  const orderClause = [
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  const rows = await query.where(and(...conditions)).orderBy(...orderClause).limit(safeLimit);

  // Settings-driven priority refinement (in JS).
  const screeningIds = rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null);
  const ctx = await buildEngagementPriorityContext(screeningIds);
  const scores = new Map<number, number>();
  for (const r of rows) scores.set(r.id, calculateEngagementCasePriority(r, ctx));
  return sortByEngagementPriority(rows, scores);
}

// ─── Engagement assignment write-side ──────────────────────────────────────

const SCHEDULER_ASSIGNMENT_BUCKETS = ["visit", "outreach", "scheduling_triage"] as const;
const LIAISON_ASSIGNMENT_BUCKETS = ["visit", "outreach"] as const;

export type EngagementTargetRole = "scheduler" | "liaison";

export type AssignEngagementCasesInput = {
  facilityId?: string;
  targetRole: EngagementTargetRole;
  limit?: number;
  assignedTeamMemberId?: number;
  dryRun?: boolean;
};

export type AssignEngagementCasePreview = {
  id: number;
  patientName: string;
  patientScreeningId: number | null;
  facilityId: string | null;
  engagementBucket: string;
  qualificationStatus: string;
  previousAssignedRole: string | null;
  previousAssignedTeamMemberId: number | null;
  previousEngagementStatus: string;
  proposedAssignedRole: EngagementTargetRole;
  proposedAssignedTeamMemberId: number | null;
  proposedEngagementStatus: string;
  applied: boolean;
};

export type AssignEngagementCasesResult = {
  dryRun: boolean;
  targetRole: EngagementTargetRole;
  count: number;
  cases: AssignEngagementCasePreview[];
};

/** Selection-and-assignment for active qualified execution cases.
 *
 *  Selection rules:
 *    lifecycleStatus = "active"
 *    qualificationStatus = "qualified"
 *    engagementStatus NOT IN (completed, closed)
 *    engagementBucket IN (scheduler: visit/outreach/scheduling_triage,
 *                        liaison: visit/outreach)
 *    facilityId = input.facilityId (when provided)
 *
 *  Ordering: same settings-driven priority refinement as
 *  listEngagementCenterCases (priorityScore DESC NULLS LAST → calculated
 *  priority DESC → nextActionAt ASC NULLS LAST → createdAt DESC).
 *
 *  Write behavior (dryRun=false):
 *    - assignedRole = targetRole
 *    - assignedTeamMemberId = input.assignedTeamMemberId WHEN PROVIDED
 *      (otherwise the existing value is preserved — owner continuity)
 *    - engagementStatus = "in_progress" iff current is "new" or "ready"
 *    - updatedAt = now
 *    - patient_journey_events row appended:
 *        eventType="engagement_assigned" eventSource="engagement_center"
 *        metadata={ targetRole, assignedTeamMemberId, dryRun: false } */
export async function assignEngagementCases(
  input: AssignEngagementCasesInput,
): Promise<AssignEngagementCasesResult> {
  const limit = Math.min(Math.max(1, input.limit ?? 25), 250);
  const dryRun = input.dryRun ?? false;
  const buckets = input.targetRole === "scheduler"
    ? [...SCHEDULER_ASSIGNMENT_BUCKETS]
    : [...LIAISON_ASSIGNMENT_BUCKETS];

  const conditions = [
    eq(patientExecutionCases.lifecycleStatus, "active"),
    eq(patientExecutionCases.qualificationStatus, "qualified"),
    notInArray(patientExecutionCases.engagementStatus, [...TERMINAL_ENGAGEMENT_STATUSES]),
    inArray(patientExecutionCases.engagementBucket, buckets),
  ];
  if (input.facilityId) conditions.push(eq(patientExecutionCases.facilityId, input.facilityId));

  const orderClause = [
    sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
    sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
    desc(patientExecutionCases.createdAt),
  ];

  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(and(...conditions))
    .orderBy(...orderClause)
    .limit(limit);

  // JS-side priority refinement (matches the read endpoints' contract)
  const screeningIds = rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null);
  const ctx = await buildEngagementPriorityContext(screeningIds);
  const scores = new Map<number, number>();
  for (const r of rows) scores.set(r.id, calculateEngagementCasePriority(r, ctx));
  const sorted = sortByEngagementPriority(rows, scores);

  const explicitTeamMember = input.assignedTeamMemberId !== undefined;
  const cases: AssignEngagementCasePreview[] = [];

  for (const row of sorted) {
    const proposedStatus = (row.engagementStatus === "new" || row.engagementStatus === "ready")
      ? "in_progress"
      : row.engagementStatus;
    const proposedAssignedTeamMemberId = explicitTeamMember
      ? (input.assignedTeamMemberId ?? null)
      : (row.assignedTeamMemberId ?? null);

    let applied = false;
    if (!dryRun) {
      const setFields: Record<string, unknown> = {
        assignedRole: input.targetRole,
        engagementStatus: proposedStatus,
        updatedAt: new Date(),
      };
      // Owner continuity — only touch assignedTeamMemberId when the caller
      // supplied a specific value. Omitting it preserves whatever was there.
      if (explicitTeamMember) {
        setFields.assignedTeamMemberId = input.assignedTeamMemberId;
      }

      const [updated] = await db
        .update(patientExecutionCases)
        .set(setFields)
        .where(eq(patientExecutionCases.id, row.id))
        .returning();

      if (updated) {
        applied = true;
        try {
          await appendPatientJourneyEvent({
            patientName: updated.patientName,
            patientDob: updated.patientDob ?? undefined,
            patientScreeningId: updated.patientScreeningId ?? undefined,
            executionCaseId: updated.id,
            eventType: "engagement_assigned",
            eventSource: "engagement_center",
            actorUserId: null,
            summary: `Assigned to ${input.targetRole}`,
            metadata: {
              targetRole: input.targetRole,
              assignedTeamMemberId: input.assignedTeamMemberId ?? null,
              previousAssignedRole: row.assignedRole ?? null,
              previousAssignedTeamMemberId: row.assignedTeamMemberId ?? null,
              previousEngagementStatus: row.engagementStatus,
              proposedEngagementStatus: proposedStatus,
              dryRun: false,
            },
          });
        } catch (err) {
          // Journey event append is best-effort — never undo the assignment
          // because of a logging miss.
          console.error("[assignEngagementCases] journey event append failed:", err);
        }
      }
    }

    cases.push({
      id: row.id,
      patientName: row.patientName,
      patientScreeningId: row.patientScreeningId ?? null,
      facilityId: row.facilityId ?? null,
      engagementBucket: row.engagementBucket,
      qualificationStatus: row.qualificationStatus,
      previousAssignedRole: row.assignedRole ?? null,
      previousAssignedTeamMemberId: row.assignedTeamMemberId ?? null,
      previousEngagementStatus: row.engagementStatus,
      proposedAssignedRole: input.targetRole,
      proposedAssignedTeamMemberId,
      proposedEngagementStatus: proposedStatus,
      applied,
    });
  }

  return { dryRun, targetRole: input.targetRole, count: cases.length, cases };
}

// ─── Call-list recall / manual-add ─────────────────────────────────────────

export type RecallToCallListInput = {
  executionCaseId?: number;
  patientScreeningId?: number;
  /** When provided, reassign ownership to this roster member (outreach_schedulers.id)
   *  so the case surfaces on that member's scoped call list. */
  assignedTeamMemberId?: number | null;
  actorUserId?: string | null;
  reason?: string;
};

/** Re-surface a completed / dismissed / dormant execution case onto the active
 *  call list. Sets a non-terminal engagement status, reactivates the lifecycle,
 *  and stamps nextActionAt=now so the case sorts to the top of the day window.
 *  The engagement bucket is normalized into a scheduler/call-list bucket when it
 *  is not already one, otherwise the call-list feed (which only reads
 *  visit/outreach/scheduling_triage) would silently drop the recalled case.
 *  Returns the updated row, or null when no matching case exists. */
export async function recallExecutionCaseToCallList(
  input: RecallToCallListInput,
): Promise<PatientExecutionCase | null> {
  let row: PatientExecutionCase | undefined;
  if (input.executionCaseId != null) {
    row = await getExecutionCaseById(input.executionCaseId);
  } else if (input.patientScreeningId != null) {
    row = await getExecutionCaseByScreeningId(input.patientScreeningId);
  }
  if (!row) return null;

  const bucketIsCallList = (SCHEDULER_DEFAULT_BUCKETS as readonly string[]).includes(
    row.engagementBucket ?? "",
  );

  const setFields: Record<string, unknown> = {
    engagementStatus: "in_progress",
    lifecycleStatus: "active",
    nextActionAt: new Date(),
    updatedAt: new Date(),
  };
  if (!bucketIsCallList) setFields.engagementBucket = "outreach";
  if (input.assignedTeamMemberId != null) {
    setFields.assignedTeamMemberId = input.assignedTeamMemberId;
  }

  const [updated] = await db
    .update(patientExecutionCases)
    .set(setFields)
    .where(eq(patientExecutionCases.id, row.id))
    .returning();
  if (!updated) return null;

  try {
    await appendPatientJourneyEvent({
      patientName: updated.patientName,
      patientDob: updated.patientDob ?? undefined,
      patientScreeningId: updated.patientScreeningId ?? undefined,
      executionCaseId: updated.id,
      eventType: "call_list_recall",
      eventSource: "team_portal",
      actorUserId: input.actorUserId ?? null,
      summary: input.reason?.trim() || "Recalled to active call list",
      metadata: {
        previousEngagementStatus: row.engagementStatus,
        previousLifecycleStatus: row.lifecycleStatus,
        previousEngagementBucket: row.engagementBucket ?? null,
        previousAssignedTeamMemberId: row.assignedTeamMemberId ?? null,
        assignedTeamMemberId:
          input.assignedTeamMemberId ?? row.assignedTeamMemberId ?? null,
        reason: input.reason?.trim() || null,
      },
    });
  } catch (err) {
    // Journey logging is best-effort — never undo the recall over a logging miss.
    console.error("[recallExecutionCaseToCallList] journey event append failed:", err);
  }

  return updated;
}

export type ListJourneyEventsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  patientName?: string;
  patientDob?: string;
  eventType?: string;
  eventTypes?: string[];
  actorUserIds?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
};

export async function listJourneyEvents(
  filters: ListJourneyEventsFilters = {},
  limit = 100,
): Promise<PatientJourneyEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];
  if (filters.executionCaseId != null) conditions.push(eq(patientJourneyEvents.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(patientJourneyEvents.patientScreeningId, filters.patientScreeningId));
  if (filters.patientName) conditions.push(eq(patientJourneyEvents.patientName, filters.patientName));
  if (filters.patientDob) conditions.push(eq(patientJourneyEvents.patientDob, filters.patientDob));
  if (filters.eventType) conditions.push(eq(patientJourneyEvents.eventType, filters.eventType));
  if (filters.eventTypes && filters.eventTypes.length > 0) conditions.push(inArray(patientJourneyEvents.eventType, filters.eventTypes));
  if (filters.actorUserIds && filters.actorUserIds.length > 0) conditions.push(inArray(patientJourneyEvents.actorUserId, filters.actorUserIds));
  if (filters.createdAfter) conditions.push(sql`${patientJourneyEvents.createdAt} >= ${filters.createdAfter}`);
  if (filters.createdBefore) conditions.push(sql`${patientJourneyEvents.createdAt} < ${filters.createdBefore}`);

  const query = db.select().from(patientJourneyEvents)
    .$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(patientJourneyEvents.createdAt)).limit(safeLimit)
    : query.orderBy(desc(patientJourneyEvents.createdAt)).limit(safeLimit);
}

/** A single call-result journey event, reduced to the fields the team-metrics
 *  read model needs (attribution + outcome + dedup key). */
export type CallResultLoggedEvent = {
  actorUserId: string | null;
  patientScreeningId: number | null;
  metadata: unknown;
  createdAt: Date | null;
};

/**
 * List EVERY `call_result_logged` journey event in a time range — the
 * canonical per-call log for the engagement-center call-result path (the
 * default portal write). Unlike {@link listJourneyEvents}, this is NOT capped
 * at 500 rows: team metrics must reflect every portal call, so a high-volume
 * day cannot silently drop calls. Only the minimal columns are selected so
 * materializing a full day of calls stays cheap.
 */
export async function listCallResultLoggedEventsInRange(
  start: Date,
  end: Date,
): Promise<CallResultLoggedEvent[]> {
  return db
    .select({
      actorUserId: patientJourneyEvents.actorUserId,
      patientScreeningId: patientJourneyEvents.patientScreeningId,
      metadata: patientJourneyEvents.metadata,
      createdAt: patientJourneyEvents.createdAt,
    })
    .from(patientJourneyEvents)
    .where(
      and(
        eq(patientJourneyEvents.eventType, "call_result_logged"),
        sql`${patientJourneyEvents.createdAt} >= ${start}`,
        sql`${patientJourneyEvents.createdAt} <= ${end}`,
      ),
    );
}
