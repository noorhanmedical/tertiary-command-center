// Per-case scheduler auto-assignment for canonical execution cases.
//
// Picks the best outreach_schedulers row for a given execution case by
// (facility match → linked user_id → highest capacity_percent), updates
// patient_execution_cases.assignedTeamMemberId / assignedRole /
// engagementStatus / nextActionAt, and emits a `scheduler_assigned`
// patient journey event (idempotent — no duplicate event per execution case).
//
// Designed to be fire-and-forget from the commit flow:
//   - patientCommitService.commitPatient (Draft → Ready)
//   - patientCommitService.ensureCanonicalSpineForScreening (booking + outreach
//     call paths that flip commit_status without going through commitPatient)
// Idempotent — calling twice on the same case never produces duplicate
// rows or journey events.
//
// Strong identifier: executionCaseId. The execution case row carries
// patientScreeningId, facilityId, lifecycleStatus, etc.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  patientExecutionCases,
  patientJourneyEvents,
  type PatientExecutionCase,
} from "@shared/schema/executionCase";
import type { OutreachScheduler } from "@shared/schema/outreach";
import {
  appendPatientJourneyEvent,
  getExecutionCaseById,
} from "../repositories/executionCase.repo";

const TERMINAL_LIFECYCLE_STATUSES = new Set(["closed", "archived", "cancelled"]);

// Statuses we'll upgrade to "assigned". Stronger states (in_progress,
// scheduled, completed, contacted, not_reached) are preserved — assignment
// must never downgrade workflow progress.
const UPGRADABLE_ENGAGEMENT_STATUSES = new Set(["new", "ready"]);

export type SchedulerAutoAssignSkippedReason =
  | "case_not_found"
  | "closed_or_archived"
  | "already_assigned"
  | "no_scheduler_for_facility";

export type SchedulerAutoAssignResult =
  | {
      applied: true;
      executionCase: PatientExecutionCase;
      schedulerId: number;
      schedulerUserId: string | null;
      schedulerName: string;
      schedulerFacility: string;
      facilityMatched: boolean;
      journeyEventId: number | null;
      journeyEventCreated: boolean;
      engagementStatusUpdated: boolean;
      nextActionAtSet: boolean;
    }
  | {
      applied: false;
      reason: SchedulerAutoAssignSkippedReason;
      executionCase?: PatientExecutionCase;
    };

/** Pick the best scheduler for a given facility:
 *  1. same facility + linked user_id, ranked by capacity_percent DESC
 *  2. fallback: any linked scheduler (any facility), ranked by capacity_percent DESC
 *  Returns null when no linked scheduler exists at all. */
function pickSchedulerForFacility(
  schedulers: OutreachScheduler[],
  facilityId: string | null,
): { scheduler: OutreachScheduler; facilityMatched: boolean } | null {
  const linked = schedulers.filter((s) => !!s.userId);
  if (linked.length === 0) return null;

  const byCapacity = (a: OutreachScheduler, b: OutreachScheduler) =>
    (b.capacityPercent ?? 100) - (a.capacityPercent ?? 100);

  if (facilityId) {
    const sameFacility = linked
      .filter((s) => s.facility === facilityId)
      .sort(byCapacity);
    if (sameFacility[0]) {
      return { scheduler: sameFacility[0], facilityMatched: true };
    }
  }

  const fallback = [...linked].sort(byCapacity);
  return fallback[0]
    ? { scheduler: fallback[0], facilityMatched: false }
    : null;
}

export async function autoAssignSchedulerForExecutionCase(
  executionCaseId: number,
  opts: { actorUserId?: string | null } = {},
): Promise<SchedulerAutoAssignResult> {
  const ec = await getExecutionCaseById(executionCaseId);
  if (!ec) return { applied: false, reason: "case_not_found" };

  if (TERMINAL_LIFECYCLE_STATUSES.has(ec.lifecycleStatus)) {
    return { applied: false, reason: "closed_or_archived", executionCase: ec };
  }

  // Already assigned — preserve owner continuity. Helper is a no-op even
  // when the previously-assigned scheduler is no longer at the facility.
  if (ec.assignedTeamMemberId != null) {
    return { applied: false, reason: "already_assigned", executionCase: ec };
  }

  const schedulers = await storage.getOutreachSchedulers();
  const pick = pickSchedulerForFacility(schedulers, ec.facilityId ?? null);
  if (!pick) {
    return { applied: false, reason: "no_scheduler_for_facility", executionCase: ec };
  }

  const { scheduler, facilityMatched } = pick;

  // Build the patch — only touch engagement_status when current value is
  // upgradable (new / ready); never overwrite a stronger workflow state.
  const updates: Record<string, unknown> = {
    assignedTeamMemberId: scheduler.id,
    assignedRole: "scheduler",
    updatedAt: new Date(),
  };
  let engagementStatusUpdated = false;
  if (!ec.engagementStatus || UPGRADABLE_ENGAGEMENT_STATUSES.has(ec.engagementStatus)) {
    updates.engagementStatus = "assigned";
    engagementStatusUpdated = true;
  }
  let nextActionAtSet = false;
  if (!ec.nextActionAt) {
    updates.nextActionAt = new Date();
    nextActionAtSet = true;
  }

  const [updated] = await db
    .update(patientExecutionCases)
    .set(updates)
    .where(eq(patientExecutionCases.id, executionCaseId))
    .returning();
  const updatedRow: PatientExecutionCase = updated ?? ec;

  // Idempotent journey event — only one scheduler_assigned per case.
  const [existingEvent] = await db
    .select({ id: patientJourneyEvents.id })
    .from(patientJourneyEvents)
    .where(
      and(
        eq(patientJourneyEvents.executionCaseId, executionCaseId),
        eq(patientJourneyEvents.eventType, "scheduler_assigned"),
      ),
    )
    .limit(1);

  let journeyEventId: number | null = existingEvent?.id ?? null;
  let journeyEventCreated = false;
  if (!existingEvent) {
    try {
      const journey = await appendPatientJourneyEvent({
        patientName: updatedRow.patientName,
        patientDob: updatedRow.patientDob ?? undefined,
        patientScreeningId: updatedRow.patientScreeningId ?? undefined,
        executionCaseId,
        eventType: "scheduler_assigned",
        eventSource: "scheduler_auto_assign",
        actorUserId: opts.actorUserId ?? undefined,
        summary: `Assigned to scheduler ${scheduler.name}${facilityMatched ? "" : " (cross-facility fallback)"}`,
        metadata: {
          schedulerId: scheduler.id,
          schedulerUserId: scheduler.userId ?? null,
          schedulerName: scheduler.name,
          schedulerFacility: scheduler.facility,
          caseFacility: ec.facilityId ?? null,
          facilityMatched,
          capacityPercent: scheduler.capacityPercent ?? null,
          previousEngagementStatus: ec.engagementStatus ?? null,
          newEngagementStatus: updatedRow.engagementStatus,
          engagementStatusUpdated,
          nextActionAtSet,
          source: "scheduler_auto_assign",
        },
      });
      journeyEventId = journey.id;
      journeyEventCreated = true;
    } catch (err: any) {
      console.error("[autoAssignSchedulerForExecutionCase] journey append failed (non-fatal):", err.message);
    }
  }

  return {
    applied: true,
    executionCase: updatedRow,
    schedulerId: scheduler.id,
    schedulerUserId: scheduler.userId ?? null,
    schedulerName: scheduler.name,
    schedulerFacility: scheduler.facility,
    facilityMatched,
    journeyEventId,
    journeyEventCreated,
    engagementStatusUpdated,
    nextActionAtSet,
  };
}
