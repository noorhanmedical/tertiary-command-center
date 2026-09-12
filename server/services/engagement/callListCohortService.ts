// Canonical Engagement call-list COHORT query service (Task 1).
//
// Given a facility + cohort (+ optional service filter and, for the
// parameterized cohort, a lookback window), this computes the CURRENT
// membership by querying patient_execution_cases live. There is NO persistent
// cohort-membership table — the current canonical state determines membership
// on every call.
//
// Every cohort is built ON TOP OF the SAME shared eligibility predicates the
// scheduler-portal call list and the distribution allocator use, so a cohort
// can never surface a patient those reads would suppress:
//   • activeLifecycleCondition            — active (or legacy-null) lifecycle
//   • activeEngagementStatusCondition     — excludes scheduled/terminal
//   • dncExclusionCondition               — DNC (outreach refusal + column)
//   • noActivePatientClaimCondition       — not being actively worked elsewhere
//   • contactFrequencySuppressionCondition— opt-in contact-fatigue policy
// Cohort-specific predicates then narrow that callable pool.
//
// Clinic-local timing (due_today / overdue) uses the facility's clinic
// timezone via the Phase 2 clinicTime helpers — never UTC midnight, never the
// server's local zone.

import { and, asc, desc, eq, inArray, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  patientExecutionCases,
  patientScreenings,
  screeningBatches,
} from "@shared/schema";
import {
  activeEngagementStatusCondition,
  activeLifecycleCondition,
  dncExclusionCondition,
  noActivePatientClaimCondition,
  contactFrequencySuppressionCondition,
  patientScreeningHasDncColumn,
  resolveContactContext,
  type ContactFrequencyPolicy,
  type ContactDayStarts,
} from "../../repositories/executionCase.repo";
import { resolveClinicTimeZone } from "./clinicTimeZone";
import {
  DEFAULT_CLINIC_TIME_ZONE,
  operationalDateInTimeZone,
  zonedWallClockToUtc,
} from "../../lib/clinicTime";
import {
  resolveNotContactedDays,
  type CallListCohortKey,
} from "@shared/engagement/callListCohorts";
import { getAncillaryCategory, type AncillaryCategory } from "@shared/ancillaryCategory";

/** Ancillary category tokens accepted from the manager UI. "ultrasound" is a
 *  CATEGORY (not a single service) and MUST be expanded server-side to the
 *  canonical ultrasound service names actually present in the scoped data. */
export type ServiceCategoryToken = Extract<
  AncillaryCategory,
  "brainwave" | "vitalwave" | "ultrasound"
>;

export type CohortQueryParams = {
  cohort: CallListCohortKey;
  /** Facility scope is REQUIRED — cohorts are always facility-scoped. */
  facility: string;
  /** Optional EXPLICIT service names (exact selected_services overlap). */
  services?: string[] | null;
  /** Optional service CATEGORY intent (brainwave/vitalwave/ultrasound). Expanded
   *  server-side via the canonical getAncillaryCategory classifier against the
   *  distinct services present at the facility — never a hard-coded UI list. */
  serviceCategories?: ServiceCategoryToken[] | null;
  /** Tenant isolation. When provided the pool is restricted to this clinic. */
  clinicId?: number | null;
  /** Manager-adjustable lookback for not_contacted_in_x_days. */
  notContactedDays?: number | null;
  now?: Date;
};

/** One cohort member, enriched for preview + reused as the distribution seam
 *  input (executionCaseId is the stable identity carried through to Confirm). */
export type CohortCase = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  facility: string | null;
  scheduleDate: string | null;
  engagementBucket: string | null;
  engagementStatus: string | null;
  qualificationStatus: string | null;
  lastCallOutcome: string | null;
  nextActionAt: string | null;
  selectedServices: string[];
  callAttemptCount: number;
};

export type CohortPreviewResult = {
  cohort: CallListCohortKey;
  facility: string;
  services: string[] | null;
  notContactedDays: number | null;
  total: number;
  preview: CohortCase[];
};

const DEFAULT_PREVIEW_LIMIT = 50;
const MAX_PREVIEW_LIMIT = 200;
/** Hard safety cap for pulling the FULL cohort for distribution (Task 3). A
 *  cohort larger than this is capped (with the total still reported honestly by
 *  countCohort) so a runaway query can never load unbounded rows. */
export const MAX_DISTRIBUTION_LIMIT = 5000;

// ─── Clinic-local day window (pure enough to unit-test) ─────────────────────

/** Add whole days to a YYYY-MM-DD string (calendar math, tz-agnostic). */
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

export type ClinicDayWindow = {
  timeZone: string;
  /** UTC instant of clinic-local start-of-today. */
  dayStart: Date;
  /** UTC instant of clinic-local start-of-tomorrow (exclusive end of today). */
  dayEndExclusive: Date;
};

/** Compute the clinic-local operational-day window for `now` in `timeZone`. */
export function computeClinicDayWindow(now: Date, timeZone: string): ClinicDayWindow {
  const tz = timeZone || DEFAULT_CLINIC_TIME_ZONE;
  const todayIso = operationalDateInTimeZone(now, tz);
  const dayStart = zonedWallClockToUtc(todayIso, 0, tz);
  const dayEndExclusive = zonedWallClockToUtc(addDaysIso(todayIso, 1), 0, tz);
  return { timeZone: tz, dayStart, dayEndExclusive };
}

/** Resolve the timezone for a facility's cohort day-window. Prefers an
 *  explicit clinicId; otherwise samples the clinic of a matching-facility
 *  execution case; falls back to the schema default. */
export async function resolveFacilityTimeZone(
  facility: string,
  clinicId: number | null | undefined,
): Promise<string> {
  if (clinicId != null) return (await resolveClinicTimeZone(clinicId)).timeZone;
  const [row] = await db
    .select({ clinicId: patientExecutionCases.clinicId })
    .from(patientExecutionCases)
    .where(
      and(
        eq(patientExecutionCases.facilityId, facility),
        isNotNull(patientExecutionCases.clinicId),
      ),
    )
    .limit(1);
  if (row?.clinicId == null) return DEFAULT_CLINIC_TIME_ZONE;
  return (await resolveClinicTimeZone(row.clinicId)).timeZone;
}

// ─── Cohort-specific SQL predicates ─────────────────────────────────────────

/** SQL: the outcome of the patient's MOST RECENT outreach attempt equals `o`. */
function latestOutcomeEquals(o: string) {
  return sql`(
    SELECT oc.outcome FROM outreach_calls oc
    WHERE oc.patient_screening_id = ${patientExecutionCases.patientScreeningId}
    ORDER BY oc.started_at DESC, oc.id DESC
    LIMIT 1
  ) = ${o}`;
}

/** SQL: the patient has NO outreach attempt at all (never called). */
function noOutreachEver() {
  return sql`NOT EXISTS (
    SELECT 1 FROM outreach_calls oc
    WHERE oc.patient_screening_id = ${patientExecutionCases.patientScreeningId}
  )`;
}

/** SQL: no outreach attempt since `cutoff` (UTC wall-clock string). */
function noOutreachSince(cutoff: Date) {
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace("T", " ");
  return sql`NOT EXISTS (
    SELECT 1 FROM outreach_calls oc
    WHERE oc.patient_screening_id = ${patientExecutionCases.patientScreeningId}
      AND oc.started_at >= ${cutoffStr}::timestamp
  )`;
}

type CohortBuildContext = {
  now: Date;
  includeDncColumn: boolean;
  contactPolicy: ContactFrequencyPolicy;
  contactDayStarts?: ContactDayStarts;
  dayWindow: ClinicDayWindow;
  notContactedDays: number;
  /** Resolved effective service-name filter (explicit ∪ expanded categories). */
  serviceFilter: { active: boolean; names: string[] };
};

/** Expand ancillary CATEGORY tokens to the concrete canonical service names
 *  actually present at the facility, using the shared getAncillaryCategory
 *  classifier (the SAME taxonomy scheduling/readiness use). No hard-coded list:
 *  distinct selected_services in scope are classified and matched. */
export async function expandServiceCategoriesToNames(
  categories: ServiceCategoryToken[],
  scope: { facility: string; clinicId?: number | null },
): Promise<string[]> {
  const wanted = new Set(categories);
  if (wanted.size === 0) return [];
  const conds = [eq(patientExecutionCases.facilityId, scope.facility)];
  if (scope.clinicId != null) conds.push(eq(patientExecutionCases.clinicId, scope.clinicId));
  const rows = await db
    .select({ svc: sql<string>`DISTINCT unnest(${patientExecutionCases.selectedServices})` })
    .from(patientExecutionCases)
    .where(and(...conds));
  return filterServiceNamesByCategory(
    rows.map((r) => r.svc),
    [...wanted],
  );
}

/** PURE: keep the service names whose canonical ancillary category is in the
 *  requested set. This is the classification step of category expansion, split
 *  out so the "Ultrasound → canonical names" mapping is unit-testable without a
 *  DB. Uses the SAME getAncillaryCategory taxonomy as scheduling/readiness. */
export function filterServiceNamesByCategory(
  names: (string | null | undefined)[],
  categories: ServiceCategoryToken[],
): string[] {
  const wanted = new Set(categories);
  if (wanted.size === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const svc = (raw ?? "").trim();
    if (!svc || seen.has(svc)) continue;
    if (wanted.has(getAncillaryCategory(svc) as ServiceCategoryToken)) {
      seen.add(svc);
      out.push(svc);
    }
  }
  return out;
}

/** Resolve the effective service-name filter: explicit names ∪ expanded
 *  categories. `active` is true when the caller requested ANY service/category
 *  filter — an active filter that resolves to zero names matches NOTHING
 *  (fail-closed), never "all". */
async function resolveServiceFilter(
  params: CohortQueryParams,
): Promise<{ active: boolean; names: string[] }> {
  const explicit = (params.services ?? []).map((s) => s.trim()).filter(Boolean);
  const categories = (params.serviceCategories ?? []).filter(Boolean);
  const active = explicit.length > 0 || categories.length > 0;
  if (!active) return { active: false, names: [] };
  const expanded = categories.length
    ? await expandServiceCategoriesToNames(categories, {
        facility: params.facility,
        clinicId: params.clinicId ?? null,
      })
    : [];
  const names = Array.from(new Set([...explicit, ...expanded]));
  return { active: true, names };
}

/** The BASELINE callable gate — identical suppression to the scheduler-portal
 *  call list + distribution allocator. Reused by every cohort AND by the
 *  Confirm-time revalidation (filterCallableExecutionCaseIds). */
export function callableBaselineConditions(opts: {
  now: Date;
  includeDncColumn: boolean;
  contactPolicy: ContactFrequencyPolicy;
  contactDayStarts?: ContactDayStarts;
}) {
  return [
    activeLifecycleCondition(),
    activeEngagementStatusCondition(),
    dncExclusionCondition(opts.includeDncColumn),
    noActivePatientClaimCondition(opts.now),
    contactFrequencySuppressionCondition(opts.contactPolicy, opts.now, opts.contactDayStarts),
  ];
}

function baselineConditions(ctx: CohortBuildContext) {
  return callableBaselineConditions({
    now: ctx.now,
    includeDncColumn: ctx.includeDncColumn,
    contactPolicy: ctx.contactPolicy,
    contactDayStarts: ctx.contactDayStarts,
  });
}

/** Confirm-time revalidation (Task 4): of the given execution-case ids, return
 *  the SUBSET that STILL passes the canonical callable gate right now. Cases
 *  not returned have become ineligible (DNC / terminal / scheduled / claimed /
 *  contact-fatigued) since preview and must be EXCLUDED (never replaced). */
export async function filterCallableExecutionCaseIds(
  executionCaseIds: number[],
  now: Date = new Date(),
): Promise<Set<number>> {
  const ids = Array.from(new Set(executionCaseIds.filter((n) => Number.isInteger(n))));
  if (ids.length === 0) return new Set<number>();
  const [includeDncColumn, contact] = await Promise.all([
    patientScreeningHasDncColumn(),
    resolveContactContext(now),
  ]);
  const rows = await db
    .select({ id: patientExecutionCases.id })
    .from(patientExecutionCases)
    .where(
      and(
        inArray(patientExecutionCases.id, ids),
        ...callableBaselineConditions({
          now,
          includeDncColumn,
          contactPolicy: contact.policy,
          contactDayStarts: contact.dayStarts,
        }),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** The cohort-specific narrowing predicate(s) on top of the baseline gate. */
function cohortConditions(cohort: CallListCohortKey, ctx: CohortBuildContext) {
  switch (cohort) {
    case "all_active_outreach":
      return [];
    case "never_called":
      return [noOutreachEver()];
    case "lvm":
      return [latestOutcomeEquals("voicemail")];
    case "no_answer":
      return [latestOutcomeEquals("no_answer")];
    case "reached_not_scheduled":
      // "reached" = successful contact; the baseline already excludes
      // scheduled/terminal, so a still-active reached case = objective open.
      return [latestOutcomeEquals("reached")];
    case "scheduling_follow_up":
      return [eq(patientExecutionCases.engagementBucket, "scheduling_triage")];
    case "callback_due":
      return [
        isNotNull(patientExecutionCases.nextActionAt),
        lte(patientExecutionCases.nextActionAt, ctx.now),
      ];
    case "due_today":
      return [
        isNotNull(patientExecutionCases.nextActionAt),
        sql`${patientExecutionCases.nextActionAt} >= ${ctx.dayWindow.dayStart}`,
        sql`${patientExecutionCases.nextActionAt} < ${ctx.dayWindow.dayEndExclusive}`,
      ];
    case "overdue":
      return [
        isNotNull(patientExecutionCases.nextActionAt),
        sql`${patientExecutionCases.nextActionAt} < ${ctx.dayWindow.dayStart}`,
      ];
    case "unassigned_eligible":
      return [isNull(patientExecutionCases.assignedTeamMemberId)];
    case "new_qualified":
      return [
        eq(patientExecutionCases.qualificationStatus, "qualified"),
        inArray(patientExecutionCases.engagementStatus, ["new", "ready", ""]),
        noOutreachEver(),
      ];
    case "not_contacted_in_x_days": {
      const cutoff = new Date(ctx.now.getTime() - ctx.notContactedDays * 86_400_000);
      return [noOutreachSince(cutoff)];
    }
    default: {
      // Exhaustiveness guard — a new cohort key must add a case above.
      const _never: never = cohort;
      throw new Error(`Unhandled cohort: ${String(_never)}`);
    }
  }
}

/** Facility + service + tenant scoping applied to every cohort query. Uses the
 *  resolved effective service filter from the context (explicit ∪ expanded). */
function scopeConditions(params: CohortQueryParams, ctx: CohortBuildContext) {
  const conds = [eq(patientExecutionCases.facilityId, params.facility)];
  if (params.clinicId != null) {
    conds.push(eq(patientExecutionCases.clinicId, params.clinicId));
  }
  if (ctx.serviceFilter.active) {
    if (ctx.serviceFilter.names.length === 0) {
      // Filter requested but nothing matched → fail-closed (match nothing).
      conds.push(sql`false` as unknown as ReturnType<typeof eq>);
    } else {
      conds.push(
        sql`${patientExecutionCases.selectedServices} && ${ctx.serviceFilter.names}::text[]` as unknown as ReturnType<
          typeof eq
        >,
      );
    }
  }
  return conds;
}

async function buildContext(params: CohortQueryParams): Promise<CohortBuildContext> {
  const now = params.now ?? new Date();
  const [includeDncColumn, contact, tz, serviceFilter] = await Promise.all([
    patientScreeningHasDncColumn(),
    resolveContactContext(now),
    resolveFacilityTimeZone(params.facility, params.clinicId),
    resolveServiceFilter(params),
  ]);
  return {
    now,
    includeDncColumn,
    contactPolicy: contact.policy,
    contactDayStarts: contact.dayStarts,
    dayWindow: computeClinicDayWindow(now, tz),
    notContactedDays: resolveNotContactedDays(params.notContactedDays),
    serviceFilter,
  };
}

function allConditions(params: CohortQueryParams, ctx: CohortBuildContext) {
  return [
    ...scopeConditions(params, ctx),
    ...baselineConditions(ctx),
    ...cohortConditions(params.cohort, ctx),
  ];
}

/** Count the CURRENT membership of a cohort. */
export async function countCohort(params: CohortQueryParams): Promise<number> {
  const ctx = await buildContext(params);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patientExecutionCases)
    .where(and(...allConditions(params, ctx)));
  return row?.n ?? 0;
}

/** List the first N cohort members (enriched for preview + distribution). */
export async function listCohortCases(
  params: CohortQueryParams,
  limit = DEFAULT_PREVIEW_LIMIT,
): Promise<CohortCase[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_PREVIEW_LIMIT);
  const ctx = await buildContext(params);
  const rows = await db
    .select()
    .from(patientExecutionCases)
    .where(and(...allConditions(params, ctx)))
    .orderBy(
      sql`${patientExecutionCases.nextActionAt} ASC NULLS LAST`,
      sql`${patientExecutionCases.priorityScore} DESC NULLS LAST`,
      desc(patientExecutionCases.createdAt),
    )
    .limit(safeLimit);
  return enrichCases(rows);
}

/** Fetch the FULL cohort membership (capped at MAX_DISTRIBUTION_LIMIT) for
 *  distribution. Same canonical query as listCohortCases; larger cap. */
export async function listCohortCasesForDistribution(
  params: CohortQueryParams,
): Promise<CohortCase[]> {
  return listCohortCases(params, MAX_DISTRIBUTION_LIMIT);
}

/** Preview envelope for the cohort-preview API: total + first N. */
export async function previewCohort(
  params: CohortQueryParams,
  limit = DEFAULT_PREVIEW_LIMIT,
): Promise<CohortPreviewResult> {
  const [total, preview] = await Promise.all([
    countCohort(params),
    listCohortCases(params, limit),
  ]);
  return {
    cohort: params.cohort,
    facility: params.facility,
    services: params.services ?? null,
    notContactedDays:
      params.cohort === "not_contacted_in_x_days"
        ? resolveNotContactedDays(params.notContactedDays)
        : null,
    total,
    preview,
  };
}

/** Enrich raw execution-case rows with facility + scheduleDate from the
 *  screening/batch spine — mirrors distributionService.gatherEligibleCases so
 *  the two reads present the same identity fields. */
async function enrichCases(
  rows: (typeof patientExecutionCases.$inferSelect)[],
): Promise<CohortCase[]> {
  if (rows.length === 0) return [];
  const screeningIds = Array.from(
    new Set(
      rows.map((r) => r.patientScreeningId).filter((id): id is number => id != null),
    ),
  );
  const screenings = screeningIds.length
    ? await db
        .select()
        .from(patientScreenings)
        .where(
          and(
            inArray(patientScreenings.id, screeningIds),
            isNull(patientScreenings.deletedAt),
          ),
        )
    : [];
  const screeningById = new Map(screenings.map((s) => [s.id, s]));
  const batchIds = Array.from(
    new Set(screenings.map((s) => s.batchId).filter((id): id is number => id != null)),
  );
  const batches = batchIds.length
    ? await db
        .select()
        .from(screeningBatches)
        .where(inArray(screeningBatches.id, batchIds))
    : [];
  const batchById = new Map(batches.map((b) => [b.id, b]));

  return rows.map((c) => {
    const screening = c.patientScreeningId != null ? screeningById.get(c.patientScreeningId) : undefined;
    const batch = screening?.batchId != null ? batchById.get(screening.batchId) : undefined;
    return {
      executionCaseId: c.id,
      patientScreeningId: c.patientScreeningId ?? null,
      patientName: c.patientName ?? screening?.name ?? "Unnamed",
      patientDob: c.patientDob ?? screening?.dob ?? null,
      facility: screening?.facility ?? batch?.facility ?? c.facilityId ?? null,
      scheduleDate: batch?.scheduleDate ?? null,
      engagementBucket: c.engagementBucket ?? null,
      engagementStatus: c.engagementStatus ?? null,
      qualificationStatus: c.qualificationStatus ?? null,
      lastCallOutcome: c.lastCallOutcome ?? null,
      nextActionAt: c.nextActionAt ? new Date(c.nextActionAt).toISOString() : null,
      selectedServices: (c.selectedServices ?? []) as string[],
      callAttemptCount: c.callAttemptCount ?? 0,
    };
  });
}
