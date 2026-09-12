// Task 4 — Idempotent CONFIRM of a reviewed call-list distribution.
//
// Correct ordering (correction 11): assignment is the important clinical write
// and commits FIRST and INDEPENDENTLY; package/artifact creation is secondary
// and its failure NEVER rolls back a legitimate assignment.
//
//   1. Idempotency: if packages already exist for this distributionOperationId,
//      return the existing result WITHOUT re-assigning (retry-safe).
//   2. Revalidate the reviewed mapping against the CURRENT canonical callable
//      gate. Cases that became ineligible (DNC / terminal / scheduled / claimed
//      / contact-fatigued) are reported as CONFLICTS and EXCLUDED — never
//      silently replaced with a different patient.
//   3. Commit canonical assignment for each surviving case→member
//      (patient_execution_cases.assignedTeamMemberId). A journey event is
//      appended ONLY when the owner actually changes, so a retry that re-runs
//      assignment cannot duplicate events. Appending the event also publishes
//      the liveActivityBus signal that refreshes Team Portals (Task 5).
//   4. Create ONE frozen package per member (idempotent by
//      uq_clp_operation_member; mints a share token). A package failure for one
//      member does NOT undo the committed assignments.
//
// This service assigns EXACTLY the reviewed membership — it never re-runs the
// global allocator.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases, patientScreenings } from "@shared/schema";
import { storage } from "../../storage";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";
import { resolveAssignmentNextActionAt } from "../callList/nextActionPolicy";
import { NON_CALLABLE_ENGAGEMENT_STATUSES } from "../../repositories/executionCase.repo";
import { filterCallableExecutionCaseIds } from "./callListCohortService";
import {
  classifyCallStatus,
  type CallStatusClass,
} from "./callListDistributionPreview";
import {
  createPackageForMember,
  listPackagesByOperation,
  type CreatePackageMemberInput,
} from "../../repositories/callListPackages.repo";
import { getCallListCohort, type CallListCohortKey } from "@shared/engagement/callListCohorts";
import {
  buildAtlasPayloadSnapshot,
  buildDemographicsSnapshot,
  buildQualificationSummary,
  computeRosterSummary,
} from "@shared/engagement/callListSnapshot";

const ASSIGNED_ROLE = "scheduler";
const PROMOTABLE_STATUSES = new Set(["", "new", "ready"]);

// Journey event emitted on each ownership change. Chosen so BOTH live streams
// forward it and refresh open Team Portals (Task 5 propagation):
//   • admin distribution stream: it is in ACTIVITY_EVENT_TYPES.
//   • portal activity-stream: matches the QUEUE_REFRESH token rule
//     ("assign"/"engagement"), driving invalidateTeamPortalScheduleQueries →
//     team-workspace-call-list refetch of /api/scheduler-portal/cases.
export const CALL_LIST_ASSIGNMENT_EVENT_TYPE = "engagement_assignment_changed";
export const CALL_LIST_ASSIGNMENT_EVENT_SOURCE = "engagement_call_list_distribution";

export type ConfirmMappingEntry = { executionCaseId: number; teamMemberId: number };

export type ConfirmDistributionInput = {
  distributionOperationId: string;
  mapping: ConfirmMappingEntry[];
  cohort: CallListCohortKey;
  facility: string;
  serviceDate?: string | null;
  services?: string[] | null;
  actorUserId?: string | null;
  now?: Date;
};

export type ConfirmConflict = { executionCaseId: number; reason: string };

export type ConfirmMemberResult = {
  teamMemberId: number;
  name: string | null;
  committedCount: number;
  packageId: number | null;
  /** Plaintext share token — surfaced ONCE on first creation, else null. */
  shareToken: string | null;
  generationStatus: string | null;
  /** "visible" | "missing_user_mapping" — assignment only shows in the portal
   *  when the roster row is linked to a login. */
  visibility: "visible" | "missing_user_mapping";
  /** True when the package artifact could not be recorded (assignment stands). */
  packageError: boolean;
};

export type ConfirmDistributionResult = {
  distributionOperationId: string;
  facility: string;
  serviceDate: string | null;
  cohort: CallListCohortKey;
  alreadyProcessed: boolean;
  members: ConfirmMemberResult[];
  totalCommitted: number;
  conflicts: ConfirmConflict[];
};

/** PHI-safe conflict reason from a loaded case row. Pure. */
export function deriveConflictReason(
  row:
    | Pick<
        typeof patientExecutionCases.$inferSelect,
        "lifecycleStatus" | "engagementStatus" | "assignedTeamMemberId"
      >
    | undefined,
): string {
  if (!row) return "Case no longer exists";
  const lifecycle = (row.lifecycleStatus ?? "").toLowerCase();
  if (lifecycle && lifecycle !== "active") return "Case is no longer active";
  const status = (row.engagementStatus ?? "").toLowerCase();
  if ((NON_CALLABLE_ENGAGEMENT_STATUSES as readonly string[]).includes(status)) {
    if (status === "scheduled") return "Patient was scheduled since preview";
    return `Case is ${status}`;
  }
  return "No longer eligible (DNC, active claim, or contact policy)";
}

/** Build the frozen (minimal) package member snapshot from canonical rows.
 *  Task 6 enriches this with bounded Atlas payload + demographics. */
function toMemberSnapshot(
  execCase: typeof patientExecutionCases.$inferSelect,
  screening: typeof patientScreenings.$inferSelect | undefined,
  orderIndex: number,
  now: Date,
): CreatePackageMemberInput {
  const services = (execCase.selectedServices ?? []) as string[];
  const status: CallStatusClass = classifyCallStatus(
    {
      callAttemptCount: execCase.callAttemptCount ?? 0,
      lastCallOutcome: execCase.lastCallOutcome ?? null,
      nextActionAt: execCase.nextActionAt ? new Date(execCase.nextActionAt).toISOString() : null,
    },
    now,
  );
  const reason = ((): string => {
    switch ((execCase.engagementBucket ?? "").toLowerCase()) {
      case "outreach":
        return "Outreach call";
      case "scheduling_triage":
        return "Scheduling triage";
      case "visit":
        return "Visit follow-up";
      default:
        return "Engagement call";
    }
  })();
  // Bounded frozen snapshots (see PHI register in callListSnapshot.ts). Only
  // built when the canonical screening is present; a stub case (no screening)
  // freezes just the identity fields it carries.
  const atlas = screening ? buildAtlasPayloadSnapshot(screening) : null;
  const demographics = screening ? buildDemographicsSnapshot(screening) : null;
  const qualification = screening ? buildQualificationSummary(screening) : null;
  return {
    executionCaseId: execCase.id,
    patientScreeningId: execCase.patientScreeningId ?? null,
    orderIndex,
    patientNameSnapshot: execCase.patientName ?? screening?.name ?? "Unnamed",
    patientDobSnapshot: execCase.patientDob ?? screening?.dob ?? null,
    patientPhoneSnapshot: screening?.phoneNumber ?? null,
    demographicsSnapshot: demographics as Record<string, unknown> | null,
    servicesSnapshot: services,
    reasonForCallSnapshot: reason,
    qualificationSummarySnapshot: qualification as Record<string, unknown> | null,
    cohortClassificationSnapshot: status,
    atlasPayloadSnapshot: atlas as Record<string, unknown> | null,
  };
}

export async function confirmCallListDistribution(
  input: ConfirmDistributionInput,
): Promise<ConfirmDistributionResult> {
  const now = input.now ?? new Date();
  const cohortDef = getCallListCohort(input.cohort);

  // ── (1) Idempotency ──────────────────────────────────────────────────────
  const existing = await listPackagesByOperation(input.distributionOperationId);
  if (existing.length > 0) {
    const schedulers = await storage.getOutreachSchedulers();
    const byId = new Map(schedulers.map((s) => [s.id, s]));
    return {
      distributionOperationId: input.distributionOperationId,
      facility: input.facility,
      serviceDate: existing[0].serviceDate ?? input.serviceDate ?? null,
      cohort: input.cohort,
      alreadyProcessed: true,
      totalCommitted: existing.reduce((n, p) => n + (p.patientCount ?? 0), 0),
      conflicts: [],
      members: existing.map((p) => {
        const s = byId.get(p.teamMemberId);
        return {
          teamMemberId: p.teamMemberId,
          name: p.teamMemberNameSnapshot ?? s?.name ?? null,
          committedCount: p.patientCount ?? 0,
          packageId: p.id,
          shareToken: null, // never re-surfaced after first creation
          generationStatus: p.generationStatus ?? null,
          visibility: (s?.userId ? "visible" : "missing_user_mapping") as
            | "visible"
            | "missing_user_mapping",
          packageError: false,
        };
      }),
    };
  }

  // ── (2) Revalidate the reviewed mapping ──────────────────────────────────
  const mappingIds = Array.from(new Set(input.mapping.map((m) => m.executionCaseId)));
  const loadedCases =
    mappingIds.length > 0
      ? await db
          .select()
          .from(patientExecutionCases)
          .where(inArray(patientExecutionCases.id, mappingIds))
      : [];
  const caseById = new Map(loadedCases.map((c) => [c.id, c]));
  const eligibleIds = await filterCallableExecutionCaseIds(mappingIds, now);

  const conflicts: ConfirmConflict[] = [];
  const survivors: ConfirmMappingEntry[] = [];
  for (const entry of input.mapping) {
    if (eligibleIds.has(entry.executionCaseId) && caseById.has(entry.executionCaseId)) {
      survivors.push(entry);
    } else {
      conflicts.push({
        executionCaseId: entry.executionCaseId,
        reason: deriveConflictReason(caseById.get(entry.executionCaseId)),
      });
    }
  }

  // Enrichment: screenings for phone snapshot.
  const survivorScreeningIds = Array.from(
    new Set(
      survivors
        .map((s) => caseById.get(s.executionCaseId)?.patientScreeningId)
        .filter((id): id is number => id != null),
    ),
  );
  const screenings = survivorScreeningIds.length
    ? await db
        .select()
        .from(patientScreenings)
        .where(
          and(
            inArray(patientScreenings.id, survivorScreeningIds),
            isNull(patientScreenings.deletedAt),
          ),
        )
    : [];
  const screeningById = new Map(screenings.map((s) => [s.id, s]));

  const schedulers = await storage.getOutreachSchedulers();
  const schedulerById = new Map(schedulers.map((s) => [s.id, s]));

  // Group survivors by team member (preserving mapping order).
  const byMember = new Map<number, ConfirmMappingEntry[]>();
  for (const s of survivors) {
    const arr = byMember.get(s.teamMemberId) ?? [];
    arr.push(s);
    byMember.set(s.teamMemberId, arr);
  }

  // ── (3) Commit canonical assignments (first, independently) ──────────────
  for (const [teamMemberId, entries] of byMember) {
    const scheduler = schedulerById.get(teamMemberId);
    for (const entry of entries) {
      const execCase = caseById.get(entry.executionCaseId)!;
      const previousOwner = execCase.assignedTeamMemberId ?? null;
      const currentStatus = execCase.engagementStatus ?? "";
      const nextStatus = PROMOTABLE_STATUSES.has(currentStatus) ? "assigned" : currentStatus;
      const nextActionAt = resolveAssignmentNextActionAt(execCase.nextActionAt ?? null, now);

      await db
        .update(patientExecutionCases)
        .set({
          assignedTeamMemberId: teamMemberId,
          assignedRole: ASSIGNED_ROLE,
          engagementStatus: nextStatus,
          nextActionAt,
          updatedAt: now,
        })
        .where(eq(patientExecutionCases.id, execCase.id));

      // Journey event ONLY when the owner actually changes (retry-safe: a
      // re-run that assigns the same owner appends nothing → no duplicates).
      if (previousOwner !== teamMemberId) {
        await appendJourneyEvent({
          patientScreeningId: execCase.patientScreeningId ?? null,
          executionCaseId: execCase.id,
          actorUserId: input.actorUserId ?? null,
          patientName: execCase.patientName ?? "Unnamed",
          patientDob: execCase.patientDob ?? null,
          eventType: CALL_LIST_ASSIGNMENT_EVENT_TYPE,
          eventSource: CALL_LIST_ASSIGNMENT_EVENT_SOURCE,
          summary: `Assigned to ${scheduler?.name ?? `member #${teamMemberId}`} via call-list distribution`,
          metadata: {
            distributionOperationId: input.distributionOperationId,
            previousSchedulerId: previousOwner,
            newSchedulerId: teamMemberId,
            cohort: input.cohort,
          },
        });
      }
    }
  }

  // ── (4) Create one frozen package per member (assignment already stands) ──
  const members: ConfirmMemberResult[] = [];
  let totalCommitted = 0;
  for (const [teamMemberId, entries] of byMember) {
    const scheduler = schedulerById.get(teamMemberId);
    const visibility: "visible" | "missing_user_mapping" = scheduler?.userId
      ? "visible"
      : "missing_user_mapping";
    totalCommitted += entries.length;

    const memberSnapshots = entries.map((entry, i) => {
      const execCase = caseById.get(entry.executionCaseId)!;
      const screening =
        execCase.patientScreeningId != null
          ? screeningById.get(execCase.patientScreeningId)
          : undefined;
      return toMemberSnapshot(execCase, screening, i, now);
    });

    // clinicId from the first case (all facility-scoped).
    const clinicId = entries
      .map((e) => caseById.get(e.executionCaseId)?.clinicId)
      .find((c) => c != null) ?? null;

    let packageId: number | null = null;
    let shareToken: string | null = null;
    let generationStatus: string | null = null;
    let packageError = false;
    try {
      const res = await createPackageForMember({
        clinicId,
        facilityId: input.facility,
        teamMemberId,
        teamMemberNameSnapshot: scheduler?.name ?? null,
        generatedByUserId: input.actorUserId ?? null,
        serviceDate: input.serviceDate ?? null,
        distributionOperationId: input.distributionOperationId,
        cohortKey: input.cohort,
        cohortLabelSnapshot: cohortDef.label,
        serviceFilterSnapshot: input.services ?? null,
        summaryMetrics: {
          committedCount: entries.length,
          ...computeRosterSummary(memberSnapshots),
        },
        members: memberSnapshots,
        now,
      });
      packageId = res.pkg.id;
      shareToken = res.token;
      generationStatus = res.pkg.generationStatus;
    } catch (e) {
      // Assignment already committed — a package failure must NOT roll it back.
      packageError = true;
      console.error(
        "[callListConfirm] package creation failed (assignment stands):",
        { teamMemberId, error: e instanceof Error ? e.message : e },
      );
    }

    members.push({
      teamMemberId,
      name: scheduler?.name ?? null,
      committedCount: entries.length,
      packageId,
      shareToken,
      generationStatus,
      visibility,
      packageError,
    });
  }

  members.sort((a, b) => b.committedCount - a.committedCount || (a.name ?? "").localeCompare(b.name ?? ""));

  return {
    distributionOperationId: input.distributionOperationId,
    facility: input.facility,
    serviceDate: input.serviceDate ?? null,
    cohort: input.cohort,
    alreadyProcessed: false,
    members,
    totalCommitted,
    conflicts,
  };
}
