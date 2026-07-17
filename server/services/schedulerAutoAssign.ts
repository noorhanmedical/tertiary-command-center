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
import { getExecutionCaseById } from "../repositories/executionCase.repo";
import { getAdminSettingValue } from "../repositories/adminSettings.repo";
import { engagementCallSettingsRepository } from "../repositories/engagementCallSettings.repo";
import { appendJourneyEvent } from "./journey/appendJourneyEvent";

const TERMINAL_LIFECYCLE_STATUSES = new Set(["closed", "archived", "cancelled"]);

// Statuses we'll upgrade to "assigned". Stronger states (in_progress,
// scheduled, completed, contacted, not_reached) are preserved — assignment
// must never downgrade workflow progress.
const UPGRADABLE_ENGAGEMENT_STATUSES = new Set(["new", "ready"]);

export type SchedulerAutoAssignSkippedReason =
  | "case_not_found"
  | "closed_or_archived"
  | "already_assigned"
  | "auto_assign_disabled"
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

function normalizeFacility(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Does this member cover the given facility via their per-member
 *  facilitiesCovered allow-list? Members with no coverage configured
 *  return false (they fall back to roster-facility matching only). */
function coversFacility(
  coverageBySchedulerId: Map<number, string[]>,
  schedulerId: number,
  facilityId: string,
): boolean {
  const covered = coverageBySchedulerId.get(schedulerId);
  if (!covered || covered.length === 0) return false;
  const target = normalizeFacility(facilityId);
  return covered.some((f) => normalizeFacility(f) === target);
}

/** Pick the best scheduler for a given facility:
 *  1. same roster facility + linked user_id, ranked by capacity_percent DESC
 *  2. a linked member who covers the facility via facilitiesCovered, ranked
 *     by capacity_percent DESC
 *  3. fallback: any linked scheduler (any facility), ranked by capacity_percent DESC
 *  Returns null when no linked scheduler exists at all.
 *
 *  facilitiesCovered routing (step 2) only ever ADDS candidates — a member
 *  with no coverage configured behaves exactly as before, and a direct
 *  roster-facility match always wins over a coverage-only match, so there is
 *  no regression for existing setups. */
export function pickSchedulerForFacility(
  schedulers: OutreachScheduler[],
  facilityId: string | null,
  coverageBySchedulerId: Map<number, string[]> = new Map(),
): {
  scheduler: OutreachScheduler;
  facilityMatched: boolean;
  coverageMatched: boolean;
} | null {
  const linked = schedulers.filter((s) => !!s.userId);
  if (linked.length === 0) return null;

  const byCapacity = (a: OutreachScheduler, b: OutreachScheduler) =>
    (b.capacityPercent ?? 100) - (a.capacityPercent ?? 100);

  if (facilityId) {
    const sameFacility = linked
      .filter((s) => s.facility === facilityId)
      .sort(byCapacity);
    if (sameFacility[0]) {
      return {
        scheduler: sameFacility[0],
        facilityMatched: true,
        coverageMatched: false,
      };
    }

    // No direct roster-facility match — route to a member who explicitly
    // covers this facility via their facilitiesCovered allow-list.
    const covers = linked
      .filter((s) => coversFacility(coverageBySchedulerId, s.id, facilityId))
      .sort(byCapacity);
    if (covers[0]) {
      return {
        scheduler: covers[0],
        facilityMatched: true,
        coverageMatched: true,
      };
    }
  }

  const fallback = [...linked].sort(byCapacity);
  return fallback[0]
    ? { scheduler: fallback[0], facilityMatched: false, coverageMatched: false }
    : null;
}

/** Build a schedulerId → facilitiesCovered map for the given schedulers from
 *  the per-member engagement call settings. Members with no row, or with an
 *  empty/unset facilitiesCovered, simply have no entry (current behavior). */
async function buildCoverageMap(
  schedulers: OutreachScheduler[],
): Promise<Map<number, string[]>> {
  const ids = schedulers.map((s) => s.id);
  const map = new Map<number, string[]>();
  if (ids.length === 0) return map;
  try {
    const settings = await engagementCallSettingsRepository.listForSchedulers(ids);
    for (const row of settings) {
      const covered = (row.facilitiesCovered ?? []).filter(
        (f) => typeof f === "string" && f.trim().length > 0,
      );
      if (covered.length > 0) map.set(row.schedulerId, covered);
    }
  } catch (err: any) {
    // Coverage is an additive optimization — never block assignment on it.
    console.error(
      "[autoAssignSchedulerForExecutionCase] coverage lookup failed (non-fatal):",
      err?.message ?? err,
    );
  }
  return map;
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

  // Manual-distribution gate. When the admin setting
  // assignment.scheduler_auto_assign_enabled is off (the default),
  // commit-time auto-assign is a no-op: the case stays unassigned and
  // lands in the Engagement Center "Unassigned / Engagement Queue"
  // pool for a manager to manually distribute to a PCS / ACS team
  // member. Scope-aware (facility override falls back to global);
  // missing/undefined value defaults to disabled (manual).
  const autoAssignSetting = await getAdminSettingValue<{ enabled?: boolean }>(
    "assignment",
    "scheduler_auto_assign_enabled",
    { facilityId: ec.facilityId ?? null },
  );
  if (!(autoAssignSetting?.enabled ?? false)) {
    return { applied: false, reason: "auto_assign_disabled", executionCase: ec };
  }

  // Already assigned — preserve owner continuity. Helper is a no-op even
  // when the previously-assigned scheduler is no longer at the facility.
  if (ec.assignedTeamMemberId != null) {
    return { applied: false, reason: "already_assigned", executionCase: ec };
  }

  const schedulers = await storage.getOutreachSchedulers();
  const coverageBySchedulerId = await buildCoverageMap(schedulers);
  const pick = pickSchedulerForFacility(
    schedulers,
    ec.facilityId ?? null,
    coverageBySchedulerId,
  );
  if (!pick) {
    return { applied: false, reason: "no_scheduler_for_facility", executionCase: ec };
  }

  const { scheduler, facilityMatched, coverageMatched } = pick;

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
      const journey = await appendJourneyEvent({
        patientName: updatedRow.patientName,
        patientDob: updatedRow.patientDob ?? undefined,
        patientScreeningId: updatedRow.patientScreeningId ?? undefined,
        executionCaseId,
        eventType: "scheduler_assigned",
        eventSource: "scheduler_auto_assign",
        actorUserId: opts.actorUserId ?? undefined,
        summary: `Assigned to scheduler ${scheduler.name}${
          coverageMatched
            ? " (covers facility)"
            : facilityMatched
              ? ""
              : " (cross-facility fallback)"
        }`,
        metadata: {
          schedulerId: scheduler.id,
          schedulerUserId: scheduler.userId ?? null,
          schedulerName: scheduler.name,
          schedulerFacility: scheduler.facility,
          caseFacility: ec.facilityId ?? null,
          facilityMatched,
          coverageMatched,
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
