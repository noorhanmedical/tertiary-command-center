// Task 3 — Cohort-scoped DISTRIBUTION PREVIEW (read-only, no writes).
//
// Given a facility + cohort (+ service filter), this:
//   1. computes the CURRENT cohort membership (Task 1 canonical query),
//   2. runs the PURE distribution allocator (distributionService.
//      buildDistributionPlan) over EXACTLY those cohort cases + the live
//      member roster (capacity-aware), and
//   3. assembles a per-member preview: capacity, ancillary mix
//      (BrainWave/VitalWave/Ultrasound), call-status mix (Never Called / LVM /
//      No Answer / Callback Due / Reached-Not-Scheduled), and the EXACT
//      proposed patient membership so the manager can inspect who gets whom.
//
// The result carries a freshly-minted previewOperationId + the exact
// executionCaseId→teamMemberId mapping. Confirm (Task 4) references that
// operation id (idempotency key) and re-validates + assigns EXACTLY this
// mapping — it never re-runs the global allocator and never silently reshuffles.
//
// This module performs NO writes and emits NO journey/assignment events.

import { randomUUID } from "crypto";
import { getAncillaryCategory } from "@shared/ancillaryCategory";
import {
  getCallListCohort,
  resolveNotContactedDays,
  type CallListCohortKey,
} from "@shared/engagement/callListCohorts";
import {
  listCohortCasesForDistribution,
  countCohort,
  resolveFacilityTimeZone,
  type CohortCase,
} from "./callListCohortService";
import {
  buildDistributionPlan,
  gatherDistributionMembers,
  type DistributionCaseInput,
} from "./distributionService";
import { operationalDateInTimeZone } from "../../lib/clinicTime";

// ─── Pure classification helpers ─────────────────────────────────────────────

export type CallStatusClass =
  | "never_called"
  | "callback_due"
  | "lvm"
  | "no_answer"
  | "reached_not_scheduled"
  | "other";

/** Classify a case's CURRENT call status from canonical execution-case fields
 *  (callAttemptCount, lastCallOutcome, nextActionAt). Pure. Callback-due takes
 *  precedence (a promised callback is the operative next step regardless of the
 *  prior outcome). */
export function classifyCallStatus(
  c: Pick<CohortCase, "callAttemptCount" | "lastCallOutcome" | "nextActionAt">,
  now: Date,
): CallStatusClass {
  const nextAction = c.nextActionAt ? new Date(c.nextActionAt) : null;
  if (nextAction && !Number.isNaN(nextAction.getTime()) && nextAction.getTime() <= now.getTime()) {
    return "callback_due";
  }
  if ((c.callAttemptCount ?? 0) === 0) return "never_called";
  const outcome = (c.lastCallOutcome ?? "").toLowerCase();
  if (outcome === "voicemail") return "lvm";
  if (outcome === "no_answer") return "no_answer";
  if (outcome === "reached") return "reached_not_scheduled";
  return "other";
}

export type AncillaryMix = { brainwave: number; vitalwave: number; ultrasound: number; other: number };
export type StatusMix = Record<CallStatusClass, number>;

function emptyAncillaryMix(): AncillaryMix {
  return { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 };
}
function emptyStatusMix(): StatusMix {
  return {
    never_called: 0,
    callback_due: 0,
    lvm: 0,
    no_answer: 0,
    reached_not_scheduled: 0,
    other: 0,
  };
}

/** Tally a patient's ancillary categories across their services. A patient
 *  counts ONCE per distinct category they carry (so a patient with two
 *  ultrasounds adds 1 to ultrasound, not 2) — matching the "how many patients
 *  need X" reading of the per-member mix. */
export function accumulateAncillaryMix(mix: AncillaryMix, services: string[]): void {
  const cats = new Set(services.map((s) => getAncillaryCategory(s)));
  if (cats.has("brainwave")) mix.brainwave += 1;
  if (cats.has("vitalwave")) mix.vitalwave += 1;
  if (cats.has("ultrasound")) mix.ultrasound += 1;
  if (cats.has("other")) mix.other += 1;
}

// ─── Preview shapes ──────────────────────────────────────────────────────────

export type PreviewPatient = {
  executionCaseId: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  services: string[];
  reasonForCall: string;
  status: CallStatusClass;
  nextActionAt: string | null;
};

export type PreviewMember = {
  teamMemberId: number;
  name: string;
  facility: string | null;
  patientCount: number;
  capacity: {
    assignedThisPlan: number;
    dailyCallCapacity: number;
    standardWorkload: number;
    projectedEffectiveWorkload: number;
    remainingCapacity: number;
  };
  ancillaryMix: AncillaryMix;
  statusMix: StatusMix;
  patients: PreviewPatient[];
};

export type PreviewUnplaced = {
  executionCaseId: number;
  patientName: string;
  reason: string;
  category: string;
};

export type CallListDistributionPreview = {
  previewOperationId: string;
  createdAt: string;
  facility: string;
  serviceDate: string;
  cohort: CallListCohortKey;
  cohortLabel: string;
  services: string[] | null;
  notContactedDays: number | null;
  totalMatches: number;
  /** Cases actually fed to the allocator (== totalMatches unless capped). */
  distributedPoolSize: number;
  members: PreviewMember[];
  unplaced: PreviewUnplaced[];
  /** EXACT proposed mapping the Confirm operation must honor. */
  mapping: Array<{ executionCaseId: number; teamMemberId: number }>;
};

// ─── Pure assembly (unit-testable without a DB) ──────────────────────────────

export type AssembleInput = {
  previewOperationId: string;
  now: Date;
  facility: string;
  serviceDate: string;
  cohort: CallListCohortKey;
  cohortLabel: string;
  services: string[] | null;
  notContactedDays: number | null;
  totalMatches: number;
  cohortCases: CohortCase[];
  plan: ReturnType<typeof buildDistributionPlan>;
};

/** Reason-for-call, mirroring engagementShared.callReasonOf (bucket-driven). */
function reasonForCall(bucket: string | null): string {
  switch ((bucket ?? "").toLowerCase()) {
    case "outreach":
      return "Outreach call";
    case "scheduling_triage":
      return "Scheduling triage";
    case "visit":
      return "Visit follow-up";
    default:
      return "Engagement call";
  }
}

export function assembleDistributionPreview(
  input: AssembleInput,
): CallListDistributionPreview {
  const caseById = new Map<number, CohortCase>(
    input.cohortCases.map((c) => [c.executionCaseId, c]),
  );
  const summaryById = new Map(input.plan.memberSummaries.map((m) => [m.schedulerId, m]));

  // Group proposed assignments by team member.
  const byMember = new Map<number, PreviewMember>();
  const mapping: Array<{ executionCaseId: number; teamMemberId: number }> = [];

  for (const a of input.plan.assignments) {
    mapping.push({ executionCaseId: a.executionCaseId, teamMemberId: a.schedulerId });
    let m = byMember.get(a.schedulerId);
    if (!m) {
      const summary = summaryById.get(a.schedulerId);
      m = {
        teamMemberId: a.schedulerId,
        name: a.schedulerName,
        facility: summary?.facility ?? a.facility ?? null,
        patientCount: 0,
        capacity: {
          assignedThisPlan: summary?.assignedTotal ?? 0,
          dailyCallCapacity: summary?.dailyCallCapacity ?? 0,
          standardWorkload: summary?.standardWorkload ?? 0,
          projectedEffectiveWorkload: summary?.projectedEffectiveWorkload ?? 0,
          remainingCapacity: summary?.remainingCapacity ?? 0,
        },
        ancillaryMix: emptyAncillaryMix(),
        statusMix: emptyStatusMix(),
        patients: [],
      };
      byMember.set(a.schedulerId, m);
    }
    const c = caseById.get(a.executionCaseId);
    const services = c?.selectedServices ?? [];
    const status = c
      ? classifyCallStatus(c, input.now)
      : ("other" as CallStatusClass);
    m.patientCount += 1;
    accumulateAncillaryMix(m.ancillaryMix, services);
    m.statusMix[status] += 1;
    m.patients.push({
      executionCaseId: a.executionCaseId,
      patientScreeningId: a.patientScreeningId ?? c?.patientScreeningId ?? null,
      patientName: a.patientName,
      patientDob: a.patientDob ?? c?.patientDob ?? null,
      services,
      reasonForCall: reasonForCall(c?.engagementBucket ?? null),
      status,
      nextActionAt: c?.nextActionAt ?? null,
    });
  }

  // Stable ordering: most patients first, then name.
  const members = Array.from(byMember.values()).sort(
    (x, y) => y.patientCount - x.patientCount || x.name.localeCompare(y.name),
  );
  for (const m of members) {
    m.patients.sort((a, b) => a.patientName.localeCompare(b.patientName));
  }

  const unplaced: PreviewUnplaced[] = input.plan.unplaced.map((u) => ({
    executionCaseId: u.executionCaseId,
    patientName: u.patientName,
    reason: u.reason,
    category: u.category,
  }));

  return {
    previewOperationId: input.previewOperationId,
    createdAt: input.now.toISOString(),
    facility: input.facility,
    serviceDate: input.serviceDate,
    cohort: input.cohort,
    cohortLabel: input.cohortLabel,
    services: input.services,
    notContactedDays: input.notContactedDays,
    totalMatches: input.totalMatches,
    distributedPoolSize: input.cohortCases.length,
    members,
    unplaced,
    mapping,
  };
}

// ─── Orchestration (DB-backed) ───────────────────────────────────────────────

export type DistributionPreviewParams = {
  cohort: CallListCohortKey;
  facility: string;
  services?: string[] | null;
  serviceCategories?: import("./callListCohortService").ServiceCategoryToken[] | null;
  clinicId?: number | null;
  notContactedDays?: number | null;
  serviceDate?: string | null;
  now?: Date;
};

export async function previewCallListDistribution(
  params: DistributionPreviewParams,
): Promise<CallListDistributionPreview> {
  const now = params.now ?? new Date();
  const cohortDef = getCallListCohort(params.cohort);

  const cohortParams = {
    cohort: params.cohort,
    facility: params.facility,
    services: params.services ?? null,
    serviceCategories: params.serviceCategories ?? null,
    clinicId: params.clinicId ?? null,
    notContactedDays: params.notContactedDays ?? null,
    now,
  };

  const [totalMatches, cohortCases, members, tz] = await Promise.all([
    countCohort(cohortParams),
    listCohortCasesForDistribution(cohortParams),
    gatherDistributionMembers({ now }),
    resolveFacilityTimeZone(params.facility, params.clinicId),
  ]);

  const serviceDate = params.serviceDate ?? operationalDateInTimeZone(now, tz);

  // Feed EXACTLY the cohort cases into the pure allocator.
  const distCases: DistributionCaseInput[] = cohortCases.map((c) => ({
    executionCaseId: c.executionCaseId,
    patientScreeningId: c.patientScreeningId,
    patientName: c.patientName,
    patientDob: c.patientDob,
    facility: c.facility,
    scheduleDate: c.scheduleDate,
    engagementBucket: c.engagementBucket,
  }));
  const plan = buildDistributionPlan(distCases, members);

  return assembleDistributionPreview({
    previewOperationId: randomUUID(),
    now,
    facility: params.facility,
    serviceDate,
    cohort: params.cohort,
    cohortLabel: cohortDef.label,
    services: params.services ?? null,
    notContactedDays:
      params.cohort === "not_contacted_in_x_days"
        ? resolveNotContactedDays(params.notContactedDays)
        : null,
    totalMatches,
    cohortCases,
    plan,
  });
}
