import { db } from "../db";
import { eq, and, or, desc, sql, inArray, notInArray, isNull, gte, lte } from "drizzle-orm";
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
import { clinics } from "@shared/schema/clinics";
import {
  DEFAULT_CLINIC_TIME_ZONE,
  isValidTimeZone,
  operationalDateInTimeZone,
  zonedWallClockToUtc,
} from "../lib/clinicTime";
import {
  getEngagementCenterDefaults,
  getInsurancePriorityDefaults,
  getGlobalAdminSettingValue,
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
  projectSelectedServicesFromAncillaryCases,
} from "../services/ancillaryCases/reconciliation";
import type { ReconcileInput } from "../services/ancillaryCases/reconciliation";
import type { AncillaryAdminReviewStatus, AncillaryQualificationStatus } from "@shared/schema/ancillaryCases";
import { recordAncillaryReconciliationFailure } from "./ancillaryCases.repo";
import { featureFlags as plexusFeatureFlags } from "../lib/featureFlags";

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
  const flagOn = plexusFeatureFlags.ancillaryCaseWrite;

  // `requestedServices` is what the caller asked for. When Phase 2B
  // is OFF this becomes the value written to selected_services (byte-
  // identical legacy behavior). When ON, the RECONCILER's projection
  // becomes the source of truth for selected_services and this list is
  // only used as the input to reconciliation.
  //
  // We treat "qualifyingTests missing/undefined" as unavailable (not
  // an intentional empty). Only an actual array is a positive
  // statement of the caller's intent.
  const requestedServicesRaw = (screening as { qualifyingTests?: string[] | null })
    .qualifyingTests;
  const requestedServicesDefined = Array.isArray(requestedServicesRaw);
  const requestedServices: string[] = requestedServicesDefined
    ? (requestedServicesRaw as string[])
    : [];
  // Legacy semantic for the selected_services column: null/undefined
  // when nothing was selected, array otherwise.
  const legacySelectedServices =
    requestedServicesDefined && requestedServices.length > 0
      ? requestedServices
      : undefined;

  if (existing) {
    // Insert-or-update WITHOUT touching selectedServices when the flag
    // is ON. The projection step below computes the canonical set and
    // writes it back — only after reconciliation succeeds.
    const setValues: Record<string, unknown> = {
      patientName: screening.name,
      patientDob: screening.dob ?? undefined,
      facilityId: screening.facility ?? undefined,
      engagementBucket,
      qualificationStatus,
      updatedAt: new Date(),
    };
    if (!flagOn) {
      setValues.selectedServices = legacySelectedServices;
    }
    const [updated] = await db
      .update(patientExecutionCases)
      .set(setValues)
      .where(eq(patientExecutionCases.id, existing.id))
      .returning();

    const syncOutcome = await syncAncillaryCasesFromScreening({
      screening,
      executionCaseId: updated.id,
      actorUserId,
      requestedServices,
      requestedServicesDefined,
      source: "execution_case_updated",
    });

    // When the flag is ON, apply the projection so selectedServices
    // reflects reality — the successfully-reconciled active cases.
    let finalRow = updated;
    if (flagOn && syncOutcome.projection !== null) {
      const [rowAfterProjection] = await db
        .update(patientExecutionCases)
        .set({ selectedServices: syncOutcome.projection.length > 0 ? syncOutcome.projection : null })
        .where(eq(patientExecutionCases.id, updated.id))
        .returning();
      if (rowAfterProjection) finalRow = rowAfterProjection;
    }

    return { executionCase: finalRow, created: false };
  }

  const insertValues: Record<string, unknown> = {
    patientScreeningId: screening.id,
    patientName: screening.name,
    patientDob: screening.dob ?? undefined,
    facilityId: screening.facility ?? undefined,
    source: "system_generated",
    engagementBucket,
    qualificationStatus,
    lifecycleStatus: "active",
    engagementStatus: "new",
  };
  if (!flagOn) {
    insertValues.selectedServices = legacySelectedServices;
  }
  const [created] = await db
    .insert(patientExecutionCases)
    .values(insertValues as never)
    .returning();

  const syncOutcome = await syncAncillaryCasesFromScreening({
    screening,
    executionCaseId: created.id,
    actorUserId,
    requestedServices,
    requestedServicesDefined,
    source: "execution_case_created",
  });

  let finalCreated = created;
  if (flagOn && syncOutcome.projection !== null) {
    const [rowAfterProjection] = await db
      .update(patientExecutionCases)
      .set({ selectedServices: syncOutcome.projection.length > 0 ? syncOutcome.projection : null })
      .where(eq(patientExecutionCases.id, created.id))
      .returning();
    if (rowAfterProjection) finalCreated = rowAfterProjection;
  }

  return { executionCase: finalCreated, created: true };
}

/**
 * Phase 2B (hardened) — canonical sync from a committed screening.
 *
 * Contract:
 *
 *   FEATURE_ANCILLARY_CASE_WRITE = OFF:
 *     Returns { projection: null, deferred: false, reconciledCount: 0,
 *               retryCount: 0, missingIdentityLinks: false }.
 *     Zero DB reads/writes. Caller preserves existing behavior.
 *
 *   FEATURE_ANCILLARY_CASE_WRITE = ON, identity links complete:
 *     1. Reconcile every requested service (bulk).
 *     2. For every failed request → record durable retry work
 *        (requested_action = "ensure_active"). Existing active case
 *        is NOT touched.
 *     3. Compute "intentionally dropped" services = (was-active in
 *        this (patient, clinic)) − (requested set) − (failed set).
 *        Only when the caller supplied a defined selectedServices
 *        list. Place these on_hold via the shared conservative helper.
 *     4. Refresh projection from active cases and return it.
 *     Returns { projection, deferred: false, ... }.
 *
 *   FEATURE_ANCILLARY_CASE_WRITE = ON, identity links MISSING:
 *     Record durable retry work for every requested service with
 *     requested_action="ensure_active". Do NOT touch any existing
 *     ancillary case. Do NOT compute a projection.
 *     Returns { projection: null, deferred: true, missingIdentityLinks: true }.
 *
 * The projection is what the caller will use to overwrite
 * `patient_execution_cases.selectedServices`. When `projection` is
 * null, the caller does NOT overwrite selectedServices.
 */
type SyncFromScreeningResult = {
  /**
   * Deduped list of active service_types for (patient, clinic) after
   * reconciliation, or null when we should NOT overwrite selectedServices
   * (flag off, deferred, or errored before reconciliation).
   */
  projection: string[] | null;
  deferred: boolean;
  missingIdentityLinks: boolean;
  reconciledCount: number;
  retryCount: number;
};

async function syncAncillaryCasesFromScreening(args: {
  screening: PatientScreening;
  executionCaseId: number | null;
  actorUserId: string | null;
  requestedServices: string[];
  requestedServicesDefined: boolean;
  source: string;
}): Promise<SyncFromScreeningResult> {
  // Delegate to the shared service — same code path used by admin-
  // review regeneration services so behavior stays identical.
  const { syncScreeningAncillaryCases } = await import(
    "../services/ancillaryCases/screeningSync"
  );
  return syncScreeningAncillaryCases(args);
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
  /** Tenant scope. undefined/null = no clinic filter (admin/global). An array
   *  narrows to those clinics; an EMPTY array matches nothing (fail closed). */
  clinicIds?: number[] | null;
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
  if (filters.clinicIds != null) {
    conditions.push(
      filters.clinicIds.length > 0
        ? inArray(patientExecutionCases.clinicId, filters.clinicIds)
        : sql`false`,
    );
  }

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
  /** Tenant scope. undefined/null = no clinic filter (admin/global). An array
   *  narrows to those clinics; an EMPTY array matches nothing (fail closed). */
  clinicIds?: number[] | null;
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
  if (filters.clinicIds != null) {
    conditions.push(
      filters.clinicIds.length > 0
        ? inArray(patientExecutionCases.clinicId, filters.clinicIds)
        : sql`false`,
    );
  }

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
  /** Multi-clinic ASSIGNMENT set — the caller's roster ids across included
   *  clinics. When present, takes precedence over the single id. */
  assignedTeamMemberIds?: number[];
  facilityId?: string;
  /** Multi-clinic ACCESS set. When present, takes precedence over facilityId. */
  facilityIds?: string[];
  engagementBucket?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  qualificationStatus?: string;
  // Operational-day window (server-side date navigation). When provided, only
  // cases whose `nextActionAt` falls within [dateStart, dateEnd] are returned.
  // `includeBacklog` controls null-nextActionAt (backlog) rows: they are the
  // "due/overdue now" pool with no scheduled day, so they belong ONLY to
  // today/future views — never to a strictly-past date (that would repeat the
  // whole backlog on every historical day). Callers pass includeBacklog=false
  // for past dates. NOTE: this is a forward/current-day filter over the mutable
  // nextActionAt pointer, NOT a historical membership reconstruction — see the
  // scheduler_assignments.asOfDate limitation reported in the milestone notes.
  dateStart?: Date;
  dateEnd?: Date;
  includeBacklog?: boolean;
};

const SCHEDULER_DEFAULT_BUCKETS = ["visit", "outreach", "scheduling_triage"] as const;

/**
 * Phase 1B — engagement statuses that mean a case has LEFT active outbound
 * calling and must be suppressed by BOTH eligibility reads (the distribution
 * allocator `gatherEligibleCases` AND the scheduler-portal call list
 * `buildSchedulerPortalConditions`). This is the SINGLE shared source of truth
 * so the two reads can never drift:
 *   • closed / completed / cancelled / archived — terminal dispositions
 *     (see resolveTerminalExecutionState in callResult/callAttemptRuntime.ts).
 *   • scheduled — the case was booked (scheduleAncillaryCore sets
 *     engagementStatus="scheduled"); the canonical scheduling path owns it, so
 *     it must never be re-distributed or re-surfaced for an ordinary call.
 * Mirrors distribution's own getActiveQueueCounts / COMPLETED_ENGAGEMENT_
 * STATUSES, which already treat "scheduled" as having left the active queue.
 */
export const NON_CALLABLE_ENGAGEMENT_STATUSES = [
  "scheduled",
  "completed",
  "closed",
  "cancelled",
  "archived",
] as const;

/** Shared engagement-status suppression predicate (see
 *  NON_CALLABLE_ENGAGEMENT_STATUSES). NULL engagementStatus (legacy rows) is
 *  treated as callable. Reused by BOTH eligibility reads. */
export function activeEngagementStatusCondition() {
  return or(
    isNull(patientExecutionCases.engagementStatus),
    notInArray(patientExecutionCases.engagementStatus, [...NON_CALLABLE_ENGAGEMENT_STATUSES]),
  );
}

/** Shared lifecycle suppression predicate — a case is callable only while its
 *  lifecycle is "active" (or NULL for legacy rows predating the column). Every
 *  terminal lifecycle value in the canonical enum (completed / archived /
 *  cancelled) plus the legacy closed/inactive variants is fail-closed excluded.
 *  Reused by BOTH eligibility reads so distribution and the call list agree. */
export function activeLifecycleCondition() {
  return or(
    isNull(patientExecutionCases.lifecycleStatus),
    eq(patientExecutionCases.lifecycleStatus, "active"),
  );
}

// Migration 0027 added patient_screenings.do_not_contact as a raw-SQL column
// that is NOT modelled in the drizzle schema and is "not universally applied".
// Probe ONCE (memoized) whether the connected DB actually has it, so the DNC
// gate can honor a directory-set DNC flag WITHOUT breaking the eligibility
// query in an environment where 0027 has not been applied. On any error we
// fail safe to "column absent" → the durable outreach_calls signal still gates.
let _dncColumnProbe: Promise<boolean> | null = null;
export function patientScreeningHasDncColumn(): Promise<boolean> {
  if (_dncColumnProbe == null) {
    _dncColumnProbe = db
      .execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient_screenings'
          AND column_name = 'do_not_contact'
        LIMIT 1
      `)
      .then((res: unknown) => {
        const rows = (res as { rows?: unknown[] })?.rows;
        return Array.isArray(rows) && rows.length > 0;
      })
      .catch(() => false);
  }
  return _dncColumnProbe;
}

/** Test-only hook to reset the memoized DNC-column probe. */
export function __resetDncColumnProbeForTests(): void {
  _dncColumnProbe = null;
}

/**
 * Phase 1B — shared DNC-exclusion predicate (the EXISTING contactRestrictions
 * do-not-contact semantics, wired into eligibility). A patient must NOT re-enter
 * ordinary outbound outreach when EITHER durable DNC fact holds:
 *   1. an outreach_calls row whose outcome is refused_dnc / dnc / do_not_contact
 *      (the universally-available signal; mirrors DNC_OUTCOMES in
 *      callResult/callAttemptRuntime.ts and the patient-directory DNC
 *      derivation), OR
 *   2. patient_screenings.do_not_contact = true (migration 0027 — the flag the
 *      Patient Directory setDoNotContact writes). Only checked when
 *      `includeDoNotContactColumn` is true, gated by patientScreeningHasDncColumn()
 *      so a DB without 0027 keeps working on signal (1) alone.
 *
 * This is the ONE server-side gate reused by BOTH the scheduler-portal read and
 * the distribution allocator so the two can never disagree. Implemented as
 * correlated NOT EXISTS — ONE SQL statement, never an N+1 (both correlation
 * columns are indexed). Rows with a null patient_screening_id (quick-schedule
 * stubs) are unaffected (the subqueries match nothing → included).
 */
export function dncExclusionCondition(includeDoNotContactColumn = false) {
  const callSignal = sql`NOT EXISTS (
    SELECT 1 FROM outreach_calls oc
    WHERE oc.patient_screening_id = ${patientExecutionCases.patientScreeningId}
      AND lower(oc.outcome) IN ('refused_dnc', 'dnc', 'do_not_contact')
  )`;
  if (!includeDoNotContactColumn) return callSignal;
  return sql`${callSignal} AND NOT EXISTS (
    SELECT 1 FROM patient_screenings ps
    WHERE ps.id = ${patientExecutionCases.patientScreeningId}
      AND ps.do_not_contact = true
  )`;
}

// ─── Phase 4 — ACTIVE-WORK CLAIM + CONTACT-FATIGUE suppression ───────────────
//
// These are ADDITIVE shared predicates wired into BOTH eligibility reads
// (distribution allocator + scheduler-portal call list) so the two can never
// disagree — the same "one gate, both reads" contract as the Phase 1B
// predicates above.
//
// BACKWARD COMPATIBILITY: with no active claims (the state of every row until a
// workspace acquires one) and the contact policy disabled (its default), all
// of these evaluate to TRUE and change nothing — pre-Phase-4 behavior exactly.

/**
 * DISTRIBUTION-side claim suppression: do NOT hand a NEW case to a worker when
 * ANY case for the same patient (self or a name+dob sibling) is being ACTIVELY
 * worked right now (valid, non-expired claim). Prevents two employees / two
 * services calling the same patient simultaneously. Correlated NOT EXISTS,
 * driven by the small partial-indexed set of currently-claimed cases
 * (idx_pec_active_claim_by), so it is cheap despite the case-insensitive match.
 */
export function noActivePatientClaimCondition(now: Date = new Date()) {
  return sql`NOT EXISTS (
    SELECT 1 FROM patient_execution_cases sib
    WHERE sib.active_claim_by IS NOT NULL
      AND sib.active_claim_expires_at > ${now}
      AND lower(sib.patient_name) = lower(${patientExecutionCases.patientName})
      AND (
        sib.patient_dob = ${patientExecutionCases.patientDob}
        OR (sib.patient_dob IS NULL AND ${patientExecutionCases.patientDob} IS NULL)
      )
  )`;
}

/**
 * PORTAL-side claim suppression: a case ACTIVELY claimed by someone OTHER than
 * its assigned owner is hidden from the call list (someone else is working it);
 * the owner's OWN active claim stays visible (that IS their active work).
 * Per-row (no correlation): keep unless a valid claim is held by a non-owner.
 */
export function portalClaimSuppressionCondition(now: Date = new Date()) {
  return or(
    isNull(patientExecutionCases.activeClaimBy),
    lte(patientExecutionCases.activeClaimExpiresAt, now),
    sql`${patientExecutionCases.activeClaimBy} = ${patientExecutionCases.assignedTeamMemberId}`,
  );
}

/** Patient-level contact-fatigue policy (OPT-IN; 0 = disabled). Sourced from
 *  admin_settings (engagement_center), NOT cooldown_records (which is clinical
 *  repeat-testing eligibility, a different concept). */
export type ContactFrequencyPolicy = {
  maxOrdinaryAttemptsPerDay: number;
  minContactIntervalMinutes: number;
};

export const DISABLED_CONTACT_FREQUENCY_POLICY: ContactFrequencyPolicy = {
  maxOrdinaryAttemptsPerDay: 0,
  minContactIntervalMinutes: 0,
};

/** Read the configured contact-fatigue policy. Defaults to DISABLED (0/0) so
 *  ordinary same-day suppression only engages once an admin turns it on —
 *  no behavior change on existing deployments. */
export async function getContactFrequencyPolicy(): Promise<ContactFrequencyPolicy> {
  try {
    const [maxSetting, intervalSetting] = await Promise.all([
      getGlobalAdminSettingValue<{ value?: number }>("engagement_center", "max_ordinary_attempts_per_day"),
      getGlobalAdminSettingValue<{ minutes?: number }>("engagement_center", "min_contact_interval_minutes"),
    ]);
    const maxPerDay = Math.max(0, Math.floor(Number(maxSetting?.value ?? 0)) || 0);
    const minInterval = Math.max(0, Math.floor(Number(intervalSetting?.minutes ?? 0)) || 0);
    return { maxOrdinaryAttemptsPerDay: maxPerDay, minContactIntervalMinutes: minInterval };
  } catch {
    return DISABLED_CONTACT_FREQUENCY_POLICY;
  }
}

/** Per-clinic start-of-operational-day boundaries (Phase 5A). The "attempts
 *  today" window must use the CLINIC-LOCAL operational day (Phase 2), not UTC
 *  midnight — otherwise a patient can be wrongly suppressed (or wrongly freed)
 *  for hours around clinic-local midnight in non-UTC timezones. Each value is
 *  the UTC instant of that clinic's local midnight, matching how
 *  outreach_calls.started_at is compared. */
export type ContactDayStarts = { perClinic: Map<number, Date>; fallback: Date };

/** Resolve every clinic's local operational-day start for `now`, reusing the
 *  Phase 2 timezone utilities (fail-safe to Central for missing/invalid tz —
 *  the same fallback as resolveClinicTimeZone). Only fetched when the contact-
 *  fatigue policy is actually enabled (opt-in), so it adds no cost by default. */
export async function resolveContactDayStarts(now: Date = new Date()): Promise<ContactDayStarts> {
  const startForTz = (tz: string): Date => zonedWallClockToUtc(operationalDateInTimeZone(now, tz), 0, tz);
  const rows = await db.select({ id: clinics.id, tz: clinics.timezone }).from(clinics);
  const perClinic = new Map<number, Date>();
  for (const r of rows) {
    const tz = isValidTimeZone(r.tz) ? (r.tz as string) : DEFAULT_CLINIC_TIME_ZONE;
    perClinic.set(r.id, startForTz(tz));
  }
  return { perClinic, fallback: startForTz(DEFAULT_CLINIC_TIME_ZONE) };
}

/** Resolve the contact-fatigue policy + (only when enabled) the per-clinic
 *  operational-day boundaries, in one place, so both scheduler-portal reads and
 *  the distribution gather stay consistent and cost nothing when disabled. */
export async function resolveContactContext(
  now: Date = new Date(),
): Promise<{ policy: ContactFrequencyPolicy; dayStarts?: ContactDayStarts }> {
  const policy = await getContactFrequencyPolicy();
  const enabled = policy.maxOrdinaryAttemptsPerDay > 0 || policy.minContactIntervalMinutes > 0;
  const dayStarts = enabled ? await resolveContactDayStarts(now) : undefined;
  return { policy, dayStarts };
}

/** Format a Date as its UTC wall-clock string ("YYYY-MM-DD HH:MM:SS").
 *  outreach_calls.started_at is `timestamp without time zone` and stores the
 *  UTC wall-clock (drizzle serializes Date via toISOString). A raw Date bound
 *  as a SQL param is serialized by node-postgres in the NODE-LOCAL timezone, so
 *  on any deployment whose process tz ≠ UTC a Date-vs-started_at comparison is
 *  shifted by that offset (e.g. a dev box on Central shifts the clinic-local
 *  day boundary by 5–6h, wrongly suppressing/freeing cases). Binding the UTC
 *  wall-clock STRING (cast ::timestamp) makes the boundary exact regardless of
 *  the process timezone. */
function utcWallClock(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** SQL for the clinic-local day-start boundary of a row, via a small CASE on
 *  patient_execution_cases.clinic_id (clinic count is tiny). Null/unknown
 *  clinic → the Central fallback. Each boundary is a UTC wall-clock string cast
 *  to `timestamp` (see utcWallClock) to match started_at exactly. */
function clinicLocalDayStartSql(dayStarts: ContactDayStarts) {
  const entries = [...dayStarts.perClinic.entries()];
  if (entries.length === 0) return sql`${utcWallClock(dayStarts.fallback)}::timestamp`;
  const whens = entries.map(([cid, d]) => sql`WHEN ${cid} THEN ${utcWallClock(d)}::timestamp`);
  return sql`(CASE ${patientExecutionCases.clinicId} ${sql.join(whens, sql` `)} ELSE ${utcWallClock(dayStarts.fallback)}::timestamp END)`;
}

/**
 * CONTACT-FATIGUE suppression (OPT-IN). Suppresses an ORDINARY case (one with
 * NO explicit callback timestamp) when the patient has already had >= max
 * meaningful outbound attempts today, OR a contact within the minimum interval.
 * Keyed on patient_screening_id (shared across a patient's services), so a
 * DIFFERENT service cannot bypass the patient-level limit.
 *
 * "TODAY" is the CLINIC-LOCAL operational day (Phase 5A fix): when `dayStarts`
 * is provided the per-clinic boundary is used; otherwise it falls back to the
 * UTC day (safety, only if the caller did not resolve boundaries). The
 * minimum-interval window is a rolling now−N minutes and is timezone-agnostic.
 *
 * NON-NEGOTIABLE exceptions:
 *   • An EXPLICIT callback (next_action_at IS NOT NULL) is EXEMPT — the promised
 *     time wins (and, because next_action_at is authoritative for timing, this
 *     never causes an EARLY callback; frequency only ever suppresses, never
 *     promotes).
 *   • DNC is handled absolutely by dncExclusionCondition (separate predicate).
 * Disabled policy (0/0) → returns TRUE (no-op).
 */
export function contactFrequencySuppressionCondition(
  policy: ContactFrequencyPolicy,
  now: Date = new Date(),
  dayStarts?: ContactDayStarts,
) {
  const enforceMax = policy.maxOrdinaryAttemptsPerDay > 0;
  const enforceInterval = policy.minContactIntervalMinutes > 0;
  if (!enforceMax && !enforceInterval) return sql`true`;

  // Clinic-local start-of-day (Phase 5A); UTC-day fallback only when unresolved.
  // Both bind a UTC wall-clock STRING (not a Date) so the boundary matches
  // started_at regardless of the process timezone (see utcWallClock).
  const dayStart = dayStarts
    ? clinicLocalDayStartSql(dayStarts)
    : sql`${utcWallClock(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)))}::timestamp`;

  const conds = [] as unknown[];
  if (enforceMax) {
    conds.push(sql`(
      SELECT count(*) FROM outreach_calls oc
      WHERE oc.patient_screening_id = ${patientExecutionCases.patientScreeningId}
        AND oc.started_at >= ${dayStart}
    ) < ${policy.maxOrdinaryAttemptsPerDay}`);
  }
  if (enforceInterval) {
    // UTC wall-clock string (not a Date) so the rolling window matches
    // started_at regardless of the process timezone (see utcWallClock).
    const cutoff = utcWallClock(new Date(now.getTime() - policy.minContactIntervalMinutes * 60_000));
    conds.push(sql`NOT EXISTS (
      SELECT 1 FROM outreach_calls oc
      WHERE oc.patient_screening_id = ${patientExecutionCases.patientScreeningId}
        AND oc.started_at > ${cutoff}::timestamp
    )`);
  }
  const freqOk = conds.length === 1 ? (conds[0] as ReturnType<typeof sql>) : sql`(${conds[0]} AND ${conds[1]})`;
  // Explicit callbacks bypass contact-fatigue entirely.
  return sql`(${patientExecutionCases.nextActionAt} IS NOT NULL OR ${freqOk})`;
}

/** Scheduler Portal read: defaults to scheduler-relevant buckets and excludes
 *  terminal engagement statuses when caller does not override. Ordered by
 *  nextActionAt ASC NULLS LAST, priorityScore DESC NULLS LAST, createdAt DESC. */
/** Shared WHERE builder for the scheduler-portal call list — used by BOTH the
 *  list read and the count variant so the badge can never disagree with the
 *  visible queue. Supports single-clinic (facilityId/assignedTeamMemberId) and
 *  multi-clinic aggregation (facilityIds[]/assignedTeamMemberIds[]). */
function buildSchedulerPortalConditions(
  filters: ListSchedulerPortalCasesFilters,
  includeDncColumn = false,
  opts: { now?: Date; contactPolicy?: ContactFrequencyPolicy; contactDayStarts?: ContactDayStarts } = {},
) {
  const now = opts.now ?? new Date();
  const contactPolicy = opts.contactPolicy ?? DISABLED_CONTACT_FREQUENCY_POLICY;
  const conditions = [];

  if (filters.engagementBucket) {
    conditions.push(eq(patientExecutionCases.engagementBucket, filters.engagementBucket));
  } else {
    conditions.push(inArray(patientExecutionCases.engagementBucket, [...SCHEDULER_DEFAULT_BUCKETS]));
  }

  // Phase 1B — SHARED engagement-status suppression (also used by the
  // distribution allocator gatherEligibleCases) so the call list and
  // distribution can never disagree on which cases have LEFT active calling
  // (terminal dispositions + scheduled). An explicit engagementStatus filter
  // still overrides for targeted views.
  if (filters.engagementStatus) {
    conditions.push(eq(patientExecutionCases.engagementStatus, filters.engagementStatus));
  } else {
    conditions.push(activeEngagementStatusCondition());
  }

  // ASSIGNMENT: prefer the multi-clinic roster-id set; fall back to single id.
  // An EMPTY assignedTeamMemberIds means "no roster id matched" → impossible
  // filter so nothing leaks (never falls through to unassigned rows).
  if (filters.assignedTeamMemberIds != null) {
    conditions.push(
      filters.assignedTeamMemberIds.length > 0
        ? inArray(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberIds)
        : eq(patientExecutionCases.assignedTeamMemberId, -1),
    );
  } else if (filters.assignedTeamMemberId != null) {
    conditions.push(eq(patientExecutionCases.assignedTeamMemberId, filters.assignedTeamMemberId));
  }

  // ACCESS: prefer the multi-clinic facility set; fall back to single facility.
  // An empty facilityIds means "no authorized clinic" → impossible filter.
  if (filters.facilityIds != null) {
    conditions.push(
      filters.facilityIds.length > 0
        ? inArray(patientExecutionCases.facilityId, filters.facilityIds)
        : sql`false`, // no authorized clinic → match nothing (fail closed)
    );
  } else if (filters.facilityId) {
    conditions.push(eq(patientExecutionCases.facilityId, filters.facilityId));
  }

  if (filters.qualificationStatus) conditions.push(eq(patientExecutionCases.qualificationStatus, filters.qualificationStatus));

  // Operational-day window over nextActionAt. Backlog (null nextActionAt) is
  // kept only when includeBacklog is true (today/future); on past dates it is
  // excluded so a historical view doesn't repeat the entire undated backlog.
  if (filters.dateStart && filters.dateEnd) {
    const inWindow = and(
      gte(patientExecutionCases.nextActionAt, filters.dateStart),
      lte(patientExecutionCases.nextActionAt, filters.dateEnd),
    );
    conditions.push(
      filters.includeBacklog
        ? (or(isNull(patientExecutionCases.nextActionAt), inWindow) as typeof inWindow)
        : inWindow,
    );
  }

  // Phase 1B — SHARED lifecycle suppression (fail-closed: null|active only),
  // reused by the distribution allocator so the two reads agree on terminal
  // lifecycle (completed/archived/cancelled) exclusion.
  if (filters.lifecycleStatus) {
    conditions.push(eq(patientExecutionCases.lifecycleStatus, filters.lifecycleStatus));
  } else {
    conditions.push(activeLifecycleCondition());
  }

  // Phase 1B: never surface a do-not-contact patient on the call list. Honors
  // the durable outreach_calls refusal signal always, and the do_not_contact
  // column (migration 0027) when the connected DB has it (includeDncColumn).
  conditions.push(dncExclusionCondition(includeDncColumn));

  // Phase 4 — hide cases actively claimed by a NON-owner (someone else is
  // working it) and, when the contact-fatigue policy is enabled, ordinary
  // same-day duplicates. Both are no-ops with no claims / a disabled policy.
  conditions.push(portalClaimSuppressionCondition(now));
  conditions.push(contactFrequencySuppressionCondition(contactPolicy, now, opts.contactDayStarts));

  return conditions;
}

/** Count of scheduler-portal cases matching the SAME filter as the list read.
 *  Powers the Call List badge; shares buildSchedulerPortalConditions so the
 *  count and the visible queue are always consistent. */
export async function countSchedulerPortalCases(
  filters: ListSchedulerPortalCasesFilters = {},
): Promise<number> {
  const now = new Date();
  const [includeDncColumn, contact] = await Promise.all([
    patientScreeningHasDncColumn(),
    resolveContactContext(now),
  ]);
  const conditions = buildSchedulerPortalConditions(filters, includeDncColumn, {
    now,
    contactPolicy: contact.policy,
    contactDayStarts: contact.dayStarts,
  });
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientExecutionCases)
    .where(and(...conditions));
  return row?.n ?? 0;
}

export async function listSchedulerPortalCases(
  filters: ListSchedulerPortalCasesFilters = {},
  limit = 100,
): Promise<PatientExecutionCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const now = new Date();
  const [includeDncColumn, contact] = await Promise.all([
    patientScreeningHasDncColumn(),
    resolveContactContext(now),
  ]);
  const conditions = buildSchedulerPortalConditions(filters, includeDncColumn, {
    now,
    contactPolicy: contact.policy,
    contactDayStarts: contact.dayStarts,
  });

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
