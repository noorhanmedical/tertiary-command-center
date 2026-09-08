// Workforce shift repository (Phase 3) — per-(member, date) shift override +
// real-time availability. Thin CRUD over team_member_shifts; the resolution
// logic (override → recurring default → none) lives in workforceService.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  teamMemberShifts,
  type TeamMemberShift,
} from "@shared/schema/workforceShifts";

export async function getShift(
  schedulerId: number,
  workDate: string,
): Promise<TeamMemberShift | undefined> {
  const [row] = await db
    .select()
    .from(teamMemberShifts)
    .where(and(eq(teamMemberShifts.schedulerId, schedulerId), eq(teamMemberShifts.workDate, workDate)))
    .limit(1);
  return row;
}

/** Batch read for one date across many members (used by distribution gather). */
export async function listShiftsForDate(
  schedulerIds: number[],
  workDate: string,
): Promise<Map<number, TeamMemberShift>> {
  const out = new Map<number, TeamMemberShift>();
  if (schedulerIds.length === 0) return out;
  const rows = await db
    .select()
    .from(teamMemberShifts)
    .where(and(inArray(teamMemberShifts.schedulerId, schedulerIds), eq(teamMemberShifts.workDate, workDate)));
  for (const r of rows) out.set(r.schedulerId, r);
  return out;
}

export type UpsertShiftInput = {
  schedulerId: number;
  workDate: string;
  clinicId?: number | null;
  working?: boolean;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  capacityOverride?: number | null;
  availabilityState?: string | null;
  availabilityReason?: string | null;
  availabilitySetAt?: Date | null;
  source?: string;
};

/** Insert or update the single (member, date) shift row. Only provided fields
 *  are written on conflict (so setting availability doesn't wipe shift times). */
export async function upsertShift(input: UpsertShiftInput): Promise<TeamMemberShift> {
  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };
  if (input.clinicId !== undefined) set.clinicId = input.clinicId;
  if (input.working !== undefined) set.working = input.working;
  if (input.shiftStart !== undefined) set.shiftStart = input.shiftStart;
  if (input.shiftEnd !== undefined) set.shiftEnd = input.shiftEnd;
  if (input.capacityOverride !== undefined) set.capacityOverride = input.capacityOverride;
  if (input.availabilityState !== undefined) set.availabilityState = input.availabilityState;
  if (input.availabilityReason !== undefined) set.availabilityReason = input.availabilityReason;
  if (input.availabilitySetAt !== undefined) set.availabilitySetAt = input.availabilitySetAt;
  if (input.source !== undefined) set.source = input.source;

  const [row] = await db
    .insert(teamMemberShifts)
    .values({
      schedulerId: input.schedulerId,
      workDate: input.workDate,
      clinicId: input.clinicId ?? null,
      working: input.working ?? true,
      shiftStart: input.shiftStart ?? null,
      shiftEnd: input.shiftEnd ?? null,
      capacityOverride: input.capacityOverride ?? null,
      availabilityState: input.availabilityState ?? null,
      availabilityReason: input.availabilityReason ?? null,
      availabilitySetAt: input.availabilitySetAt ?? null,
      source: input.source ?? "manual",
    } as never)
    .onConflictDoUpdate({
      target: [teamMemberShifts.schedulerId, teamMemberShifts.workDate],
      set,
    })
    .returning();
  return row;
}
