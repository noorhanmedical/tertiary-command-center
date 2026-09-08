// Workforce availability control surface (Phase 3) — the DB-orchestration layer
// that sets a member's shift / real-time availability and triggers SAFE
// redistribution on early departure. It COORDINATES existing canonical
// services (workforceService pure logic, releaseAndRedistributeCanonical,
// applyDistribution) — it is NOT a new allocator/redistribution engine.

import { and, eq, notInArray, lte, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { outreachSchedulers } from "@shared/schema/outreach";
import { NON_CALLABLE_ENGAGEMENT_STATUSES } from "../../repositories/executionCase.repo";
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";
import { getShift, upsertShift } from "../../repositories/workforceShifts.repo";
import { resolveClinicTimeZone } from "./clinicTimeZone";
import {
  operationalDateInTimeZone,
  weekdayInTimeZone,
  localMinutesInTimeZone,
} from "../../lib/clinicTime";
import { resolveShiftDay } from "./workforceService";
import { isClaimActive } from "./workClaimService";
import { releaseAndRedistributeCanonical, type CanonicalRedistributionResult } from "./absenceRedistribution";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";
import type { WorkforceAvailabilityState } from "@shared/schema/workforceShifts";

/** Availability states that mean the member is LEAVING / gone (redistribute
 *  their DUE work). Breaks/meetings stop NEW work but the member returns, so
 *  they do NOT trigger redistribution. */
const REDISTRIBUTE_ON_STATES: readonly WorkforceAvailabilityState[] = ["finish_current_only", "unavailable"];

async function resolveMemberContext(schedulerId: number): Promise<{
  clinicId: number | null;
  clinicTz: string;
  defaultShiftStart: string | null;
  defaultShiftEnd: string | null;
  workWeekdays: number[] | null;
}> {
  const [sched] = await db
    .select({ clinicId: outreachSchedulers.clinicId })
    .from(outreachSchedulers)
    .where(eq(outreachSchedulers.id, schedulerId))
    .limit(1);
  const clinicId = sched?.clinicId ?? null;
  const tz = await resolveClinicTimeZone(clinicId);
  const settings = await engagementCallSettingsRepository.getByScheduler(schedulerId);
  return {
    clinicId,
    clinicTz: tz.timeZone,
    defaultShiftStart: settings?.defaultShiftStart ?? null,
    defaultShiftEnd: settings?.defaultShiftEnd ?? null,
    workWeekdays: (settings?.workWeekdays as number[] | null) ?? null,
  };
}

/**
 * Will the member be available (scheduled + within a shift window, or no shift
 * model) at `instant`? Used to decide whether a FUTURE callback can stay with
 * them. No shift model → true (preserve, legacy behavior).
 */
export async function memberAvailableAtInstant(
  schedulerId: number,
  instant: Date,
  ctx?: Awaited<ReturnType<typeof resolveMemberContext>>,
): Promise<boolean> {
  const c = ctx ?? (await resolveMemberContext(schedulerId));
  const date = operationalDateInTimeZone(instant, c.clinicTz);
  const weekday = weekdayInTimeZone(instant, c.clinicTz);
  const minutes = localMinutesInTimeZone(instant, c.clinicTz);
  const override = await getShift(schedulerId, date);
  const shiftDay = resolveShiftDay({
    weekday,
    override: override
      ? { working: override.working, shiftStart: override.shiftStart, shiftEnd: override.shiftEnd, capacityOverride: override.capacityOverride }
      : null,
    defaultShiftStart: c.defaultShiftStart,
    defaultShiftEnd: c.defaultShiftEnd,
    workWeekdays: c.workWeekdays,
  });
  if (shiftDay.shiftWorking === false) return false;
  if (!shiftDay.window.hasWindow) return true; // no window → available all working day
  return minutes >= (shiftDay.window.startMinutes as number) && minutes < (shiftDay.window.endMinutes as number);
}

/**
 * Early-departure redistribution (Part 10/11/12). Classifies the member's
 * currently-owned, still-callable cases:
 *   • DUE / overdue (nextActionAt null or <= now)     → release + redistribute
 *   • FUTURE callback the member WILL still cover      → PRESERVE (keep owner)
 *   • FUTURE callback in a window the member is NOT
 *     scheduled/available for                          → release (move owner;
 *       releaseAndRedistributeCanonical preserves nextActionAt EXACTLY)
 *   • terminal/scheduled (non-callable)                → never touched
 * Delegates the actual release+reassign to the canonical, scoped
 * releaseAndRedistributeCanonical (no new engine).
 */
export async function redistributeForEarlyDeparture(
  schedulerId: number,
  reason: string,
  actorUserId: string | null = null,
  now: Date = new Date(),
): Promise<CanonicalRedistributionResult> {
  const ctx = await resolveMemberContext(schedulerId);

  // Owned, active, still-callable cases (exclude terminal/scheduled). Also read
  // the claim columns so an ACTIVELY-worked case is protected (Phase 4).
  const owned = await db
    .select({
      id: patientExecutionCases.id,
      nextActionAt: patientExecutionCases.nextActionAt,
      activeClaimBy: patientExecutionCases.activeClaimBy,
      activeClaimExpiresAt: patientExecutionCases.activeClaimExpiresAt,
    })
    .from(patientExecutionCases)
    .where(
      and(
        eq(patientExecutionCases.assignedTeamMemberId, schedulerId),
        eq(patientExecutionCases.lifecycleStatus, "active"),
        notInArray(patientExecutionCases.engagementStatus, [...NON_CALLABLE_ENGAGEMENT_STATUSES]),
      ),
    );

  const releaseIds: number[] = [];
  for (const c of owned) {
    // Phase 4 — a case the departing member is ACTIVELY working right now
    // (valid claim) is protected: never redistributed on early departure. It
    // stays with them until they finish / release / the lease lapses (the
    // canonical release also enforces this, so this is defense in depth + a
    // correct release count).
    if (isClaimActive(c, now)) continue;
    const due = c.nextActionAt == null || new Date(c.nextActionAt as unknown as string) <= now;
    if (due) {
      releaseIds.push(c.id); // due/overdue → redistribute
      continue;
    }
    // Future callback — preserve with the member ONLY if they will still be
    // available at the callback time; otherwise move (timing preserved).
    const willCover = await memberAvailableAtInstant(schedulerId, new Date(c.nextActionAt as unknown as string), ctx);
    if (!willCover) releaseIds.push(c.id);
  }

  return releaseAndRedistributeCanonical(schedulerId, reason, actorUserId, { onlyCaseIds: releaseIds });
}

export type SetAvailabilityResult = {
  schedulerId: number;
  workDate: string;
  state: WorkforceAvailabilityState;
  redistribution: CanonicalRedistributionResult | null;
};

/**
 * Set a member's REAL-TIME availability for today (break / meeting / leaving
 * early / unavailable / back to available). Persists the state, audits it, and
 * — for leaving states — triggers a scoped early-departure redistribution of
 * DUE work (new work is stopped immediately via the availability gate either
 * way). Breaks/meetings stop new work but keep the member's queue intact.
 */
export async function setMemberAvailabilityState(
  schedulerId: number,
  state: WorkforceAvailabilityState,
  reason: string | null,
  actorUserId: string | null = null,
  now: Date = new Date(),
): Promise<SetAvailabilityResult> {
  const ctx = await resolveMemberContext(schedulerId);
  const workDate = operationalDateInTimeZone(now, ctx.clinicTz);

  await upsertShift({
    schedulerId,
    workDate,
    clinicId: ctx.clinicId,
    availabilityState: state,
    availabilityReason: reason ?? null,
    availabilitySetAt: now,
    source: state === "finish_current_only" ? "early_departure" : "manual",
  });

  try {
    await appendJourneyEvent({
      actorUserId,
      patientName: "",
      eventType: "engagement_assignment_changed",
      eventSource: "workforce_availability",
      summary: `Availability set to ${state}${reason ? ` (${reason})` : ""} for scheduler #${schedulerId}`,
      metadata: { schedulerId, workforceAvailabilityState: state, reason: reason ?? null, action: "set_availability" },
    });
  } catch {
    /* best-effort audit */
  }

  let redistribution: CanonicalRedistributionResult | null = null;
  if (REDISTRIBUTE_ON_STATES.includes(state)) {
    redistribution = await redistributeForEarlyDeparture(schedulerId, `availability:${state}`, actorUserId, now);
  }
  return { schedulerId, workDate, state, redistribution };
}

export type SetShiftResult = {
  schedulerId: number;
  workDate: string;
  redistribution: CanonicalRedistributionResult | null;
};

/**
 * Set / override a member's shift for a date (late start, early end, day off,
 * capacity override). If the change makes the member OFF right now (working
 * false, or the new shift end is already in the past today), a scoped
 * early-departure redistribution runs; otherwise the real-time gate handles
 * new-work suppression at the shift boundary.
 */
export async function setMemberShift(
  schedulerId: number,
  input: {
    workDate: string;
    working?: boolean;
    shiftStart?: string | null;
    shiftEnd?: string | null;
    capacityOverride?: number | null;
    source?: string;
  },
  actorUserId: string | null = null,
  now: Date = new Date(),
): Promise<SetShiftResult> {
  const ctx = await resolveMemberContext(schedulerId);
  await upsertShift({
    schedulerId,
    clinicId: ctx.clinicId,
    workDate: input.workDate,
    working: input.working,
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    capacityOverride: input.capacityOverride,
    source: input.source ?? "manual",
  });

  try {
    await appendJourneyEvent({
      actorUserId,
      patientName: "",
      eventType: "engagement_assignment_changed",
      eventSource: "workforce_availability",
      summary: `Shift set for scheduler #${schedulerId} on ${input.workDate}`,
      metadata: { schedulerId, action: "set_shift", ...input },
    });
  } catch {
    /* best-effort audit */
  }

  // Redistribute DUE work only when the change takes the member OFF today.
  let redistribution: CanonicalRedistributionResult | null = null;
  const isToday = input.workDate === operationalDateInTimeZone(now, ctx.clinicTz);
  if (isToday) {
    const offNow =
      input.working === false ||
      (!!input.shiftEnd && localMinutesInTimeZone(now, ctx.clinicTz) >= hhmm(input.shiftEnd));
    if (offNow) {
      redistribution = await redistributeForEarlyDeparture(schedulerId, "shift_change", actorUserId, now);
    }
  }
  return { schedulerId, workDate: input.workDate, redistribution };
}

function hhmm(v: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return Number.POSITIVE_INFINITY; // malformed → never "past"
  return Number(m[1]) * 60 + Number(m[2]);
}
