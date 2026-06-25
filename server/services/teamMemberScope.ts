// Resolves the call-list assignment scope for a team-portal request.
//
// Background: Engagement Center writes assignments to
// patient_execution_cases.assignedTeamMemberId, which is INTEGER and
// references outreach_schedulers.id (the clinic roster — one row per
// team member per facility). That roster id is the CANONICAL assignment
// owner. Login users (users.id, UUID) are a separate identity space and,
// in this org, the roster is NOT linked to any login account.
//
// This module is the single bridge between those two identity spaces:
//   - listAssignableTeamMembers  → the roster entries an admin can
//                                  "view as" (the real assignment owners).
//   - resolveViewAsRosterMember  → admin-only: a view-as roster id → the
//                                  OutreachScheduler row it points at.
//   - resolveCallListAssignmentScope → the scheduler.id that should be
//                                  applied as `assignedTeamMemberId` on
//                                  the listSchedulerPortalCases call.
//
// Without this resolver, the call-list feed sees every case in the
// facility (the shell only narrows by facility), so patients assigned to
// a specific roster member (Callista, Ashraful, …) from the Engagement
// Center never appear in that member's workspace queue.
//
// Rules for resolveCallListAssignmentScope:
//   - Admin with view-as → filter to the viewed-as roster member's id.
//                          Lock = true.
//   - Admin pass-through (no view-as) → no narrowing. Lock = false.
//   - Non-admin caller → filter to *their own* roster id for the
//                        requested facility (via the optional
//                        outreach_schedulers.userId linkage). Lock = true.
//
// The "locked" flag tells the caller: ignore any client-supplied
// assignedTeamMemberId override — defense in depth.

import type { Request } from "express";
import { storage } from "../storage";
import type { OutreachScheduler } from "@shared/schema/outreach";
import { engagementCallSettingsRepository } from "../repositories/engagementCallSettings.repo";

export type CallListAssignmentScope = {
  /** When non-null, narrow the feed to assignedTeamMemberId = this value. */
  schedulerId: number | null;
  /** When true, the resolved schedulerId is mandatory — the route MUST
   *  apply it and MUST NOT honor a client-supplied override. When false,
   *  admin pass-through is in effect and the caller may apply a client-
   *  supplied assignedTeamMemberId filter or leave the feed unscoped. */
  locked: boolean;
};

/** A clinic-roster entry presented to the admin View-as picker. `id` is the
 *  outreach_schedulers.id rendered as a string (the canonical view-as token).
 *  `userId` is the optional linked login account (null when the roster member
 *  has no login). */
export type AssignableTeamMember = {
  id: string;
  name: string;
  facility: string;
  capacityPercent: number;
  dailyTarget: number | null;
  userId: string | null;
  /** Extra facilities this member explicitly covers via their per-member
   *  engagement call settings (facilitiesCovered). Empty when none are
   *  configured. Lets a manual assignment picker surface coverage-based
   *  routing suggestions even when commit-time auto-assign is OFF. */
  facilitiesCovered: string[];
};

function toAssignableTeamMember(
  s: OutreachScheduler,
  coverageBySchedulerId: Map<number, string[]>,
): AssignableTeamMember {
  return {
    id: String(s.id),
    name: s.name,
    facility: s.facility,
    capacityPercent: s.capacityPercent,
    dailyTarget: s.dailyTarget ?? null,
    userId: s.userId ?? null,
    facilitiesCovered: coverageBySchedulerId.get(s.id) ?? [],
  };
}

/**
 * Build a schedulerId → facilitiesCovered map for the given roster ids from
 * the per-member engagement call settings. Members with no row, or with an
 * empty/unset facilitiesCovered, simply have no entry. Best-effort: a lookup
 * failure resolves to an empty map so coverage is treated as "not configured"
 * rather than breaking the caller.
 */
export async function getCoverageMapForSchedulers(
  schedulerIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (schedulerIds.length === 0) return map;
  try {
    const settings =
      await engagementCallSettingsRepository.listForSchedulers(schedulerIds);
    for (const row of settings) {
      const covered = (row.facilitiesCovered ?? []).filter(
        (f) => typeof f === "string" && f.trim().length > 0,
      );
      if (covered.length > 0) map.set(row.schedulerId, covered);
    }
  } catch (err) {
    console.error(
      "[teamMemberScope] coverage lookup failed; treating coverage as empty:",
      err instanceof Error ? err.message : err,
    );
  }
  return map;
}

/**
 * List the clinic-roster entries that can receive assigned work. Both PCS
 * and ACS share the same roster — the roster has no role split, and per the
 * business rule a route/role only sets the DEFAULT workspace mode, never who
 * may own assigned work. Optionally narrowed to a facility allow-list.
 *
 * @param opts.facilities  When provided, only roster entries whose facility
 *                         is in this set are returned. Pass null/undefined
 *                         (admin "all facilities") to return the full roster.
 */
export async function listAssignableTeamMembers(opts?: {
  facilities?: Set<string> | null;
}): Promise<AssignableTeamMember[]> {
  const rows = await storage.getOutreachSchedulers();
  const facilities = opts?.facilities ?? null;
  const scoped = rows.filter((r) =>
    facilities ? facilities.has(r.facility) : true,
  );
  const coverage = await getCoverageMapForSchedulers(scoped.map((r) => r.id));
  return scoped
    .map((r) => toAssignableTeamMember(r, coverage))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Admin-only: resolve a `viewAsTeamMemberId` (a roster id, as a string) into
 * the OutreachScheduler row it points at. Returns null for non-admin callers,
 * for a missing/blank value, or when the id does not match a roster row.
 */
export async function resolveViewAsRosterMember(
  req: Request,
  rawViewAsTeamMemberId: string | undefined,
): Promise<OutreachScheduler | null> {
  if ((req.session.role ?? "") !== "admin") return null;
  const candidate = (rawViewAsTeamMemberId ?? "").trim();
  if (!candidate) return null;
  const id = parseInt(candidate, 10);
  if (!Number.isFinite(id)) return null;
  const rows = await storage.getOutreachSchedulers();
  return rows.find((r) => r.id === id) ?? null;
}

async function lookupSchedulerIdForFacility(
  userId: string,
  facility: string,
): Promise<number | null> {
  const rows = await storage.getOutreachSchedulers();
  const match = rows.find((r) => r.userId === userId && r.facility === facility);
  return match ? match.id : null;
}

/**
 * Resolve the call-list scheduler.id filter for the current request.
 *
 * @param req            Express request (used for session role / userId).
 * @param facilityId     The facility the caller is scoped to (post-facility-
 *                       scope-resolution). May be null when admin pass-through
 *                       is in effect.
 * @param viewAsRoster   The viewed-as roster member when admin view-as is
 *                       active (resolved via resolveViewAsRosterMember). Null
 *                       when admin pass-through OR a non-admin caller.
 */
export async function resolveCallListAssignmentScope(
  req: Request,
  facilityId: string | null,
  viewAsRoster: OutreachScheduler | null,
): Promise<CallListAssignmentScope> {
  const isAdmin = (req.session.role ?? "") === "admin";

  // Admin view-as: lock the feed to the viewed-as roster member's id. This
  // is the surface this resolver was created to fix — an Engagement-assigned
  // case is keyed by outreach_schedulers.id, so the call list must filter by
  // that same id to show that member's assigned work.
  if (isAdmin && viewAsRoster) {
    return { schedulerId: viewAsRoster.id, locked: true };
  }

  // Admin pass-through: no narrowing — admin sees every case in the
  // (post-facility-scope) feed. A client-supplied assignedTeamMemberId
  // is still honored by the route layer for backwards-compat.
  if (isAdmin) {
    return { schedulerId: null, locked: false };
  }

  // Non-admin: filter to the caller's own roster id for the requested
  // facility (via the optional outreach_schedulers.userId linkage).
  const userId = req.session.userId ?? null;
  if (!userId || !facilityId) {
    return { schedulerId: null, locked: true };
  }
  const schedulerId = await lookupSchedulerIdForFacility(userId, facilityId);
  return { schedulerId, locked: true };
}
