// Authorization for scheduling-capacity mutations.
//
// - Permanent DEFAULT capacity (machine counts / durations): admin only.
// - Temporary operational overrides (a machine down today): admin OR a user
//   who is an active member of a PCS or ACS team. PCS/ACS are operationally
//   closest to the equipment and must be able to mark a machine down without
//   waiting for an admin. We gate on a SPECIFIC capability, never "any role".

import type { Request } from "express";

export function sessionRole(req: Request): string {
  return (req as Request & { session?: { role?: string } }).session?.role ?? "clinician";
}

export function sessionUserId(req: Request): string | null {
  return (req as Request & { session?: { userId?: string } }).session?.userId ?? null;
}

/** Admin may always change permanent defaults. */
export function canEditDefaultCapacity(req: Request): boolean {
  return sessionRole(req) === "admin";
}

/**
 * May the caller create/lift a TEMPORARY capacity override? Admin always; else
 * the caller must be an active member of at least one PCS or ACS team.
 */
export async function canOverrideCapacity(req: Request): Promise<boolean> {
  if (sessionRole(req) === "admin") return true;
  const userId = sessionUserId(req);
  if (!userId) return false;
  try {
    const { teamsRepository } = await import("../../repositories/teams.repo");
    const memberships = await teamsRepository.listMembershipsForUser(userId, true);
    if (memberships.length === 0) return false;
    for (const m of memberships) {
      const team = await teamsRepository.getTeam(m.teamId);
      if (team && (team.type === "PCS" || team.type === "ACS")) return true;
    }
    return false;
  } catch {
    return false;
  }
}
