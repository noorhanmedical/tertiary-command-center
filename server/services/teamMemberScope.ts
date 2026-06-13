// Resolves the call-list assignment scope for a team-portal request.
//
// Background: Engagement Center writes assignments to
// patient_execution_cases.assignedTeamMemberId, which is INTEGER and
// references outreach_schedulers.id (one row per user-per-facility).
// Admin view-as + the workspace session work in users.id (UUID).
// The bridge is outreach_schedulers.userId.
//
// Without this resolver, the call-list feed sees every case in the
// facility (because the shell only narrows by facility), so patients
// assigned to a specific PCS/ACS user (Anthony, Callista, …) from
// Engagement never appear in that user's workspace queue.
//
// This module returns the scheduler.id that should be applied as
// `assignedTeamMemberId` on the listSchedulerPortalCases call.
//
// Rules:
//   - Non-admin caller → must be filtered to *their own* scheduler.id
//                       for the requested facility. Lock = true.
//   - Admin with view-as → filter to the viewed-as user's scheduler.id
//                          for the requested facility. Lock = true.
//   - Admin pass-through (no view-as) → no narrowing. Lock = false.
//
// The "locked" flag tells the caller: ignore any client-supplied
// assignedTeamMemberId override — defense in depth.

import type { Request } from "express";
import { storage } from "../storage";

export type CallListAssignmentScope = {
  /** When non-null, narrow the feed to assignedTeamMemberId = this value. */
  schedulerId: number | null;
  /** When true, the resolved schedulerId is mandatory — the route MUST
   *  apply it and MUST NOT honor a client-supplied override. When false,
   *  admin pass-through is in effect and the caller may apply a client-
   *  supplied assignedTeamMemberId filter or leave the feed unscoped. */
  locked: boolean;
};

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
 * @param req                 Express request (used for session role / userId).
 * @param facilityId          The facility the caller is scoped to (post-
 *                            facility-scope-resolution). May be null when
 *                            admin pass-through is in effect.
 * @param viewAsUserId        The viewed-as user's UUID when admin view-as
 *                            is active. Null when admin pass-through OR
 *                            non-admin caller.
 */
export async function resolveCallListAssignmentScope(
  req: Request,
  facilityId: string | null,
  viewAsUserId: string | null,
): Promise<CallListAssignmentScope> {
  const isAdmin = (req.session.role ?? "") === "admin";

  // Admin view-as: resolve the viewed-as user's scheduler.id for the
  // requested facility. This is the surface PR B was created to fix.
  if (isAdmin && viewAsUserId && facilityId) {
    const schedulerId = await lookupSchedulerIdForFacility(viewAsUserId, facilityId);
    return { schedulerId, locked: true };
  }

  // Admin pass-through: no narrowing — admin sees every case in the
  // (post-facility-scope) feed. A client-supplied assignedTeamMemberId
  // is still honored by the route layer for backwards-compat.
  if (isAdmin) {
    return { schedulerId: null, locked: false };
  }

  // Non-admin: filter to the caller's own scheduler.id for the
  // requested facility.
  const userId = req.session.userId ?? null;
  if (!userId || !facilityId) {
    return { schedulerId: null, locked: true };
  }
  const schedulerId = await lookupSchedulerIdForFacility(userId, facilityId);
  return { schedulerId, locked: true };
}
