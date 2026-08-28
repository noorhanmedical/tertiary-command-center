// User reactivation (Phase 4E / decision K12).
//
// The other half of deactivation. When an admin reactivates a user:
//   - users.active → true (done by the caller)
//   - restore operational call eligibility: engagement_call_settings.active →
//     true for the user's roster schedulers (deactivation recovery set these
//     false so the distribution engine excluded them)
//   - DO NOT reassign historical ownership — reactivation restores ELIGIBILITY
//     only; the user starts with an empty live queue and gets new work through
//     the normal distribution path.
//   - team memberships / facility coverage rows are untouched (their active
//     history stands on its own).

import { storage } from "../../storage";
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";

export interface ReactivateUserResult {
  userId: string;
  schedulerIds: number[];
  callSettingsRestored: number;
}

export async function reactivateUserEligibility(userId: string): Promise<ReactivateUserResult> {
  const schedulers = (await storage.getOutreachSchedulers()).filter((s) => s.userId === userId);
  const schedulerIds = schedulers.map((s) => s.id);
  let restored = 0;
  for (const sid of schedulerIds) {
    // Restore call eligibility. Upsert active=true (deactivation may have
    // created the row with active=false). We do NOT touch any other setting —
    // the member's prior workload %, KPIs, coverage, etc. are preserved.
    await engagementCallSettingsRepository.upsert(sid, { active: true });
    restored += 1;
  }
  return { userId, schedulerIds, callSettingsRestored: restored };
}
