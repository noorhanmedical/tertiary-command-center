// Scheduler Settings lookup for Admin Review approval + Engagement
// assignment. The canonical "scheduler settings" today are admin-
// edited rows in the outreach_schedulers table (managed via the
// Settings → Scheduler Team card). This helper makes that link
// explicit so callers can document the chain:
//
//   admin-approval → schedulerSettings.lookupSchedulerFromSettings(facility)
//   → commitPatient → autoAssignSchedulerForExecutionCase
//   → patient_execution_cases.assignedTeamMemberId
//   → engagement assignment board / call lists
//
// If no scheduler is configured for a facility, the helper returns
// null and the caller falls back to the engagement queue.
//
// SOURCE MARKER: Scheduler Settings drive Engagement assignment
// SOURCE MARKER: Engagement Center uses assigned scheduler from scheduler settings
// SOURCE MARKER: Scheduler settings fallback is Unassigned Engagement Queue

import { storage } from "../storage";
import type { OutreachScheduler } from "@shared/schema/outreach";

export type SchedulerSettingsLookupResult = {
  scheduler: OutreachScheduler | null;
  // "outreach-schedulers-table" when a Settings-managed scheduler
  // row matches the facility; "missing" when no row matches and the
  // caller should fall back to the engagement queue.
  source: "outreach-schedulers-table" | "missing";
  // The facility key the lookup ran against. Echoed for audit/log.
  facility: string | null;
};

// Pulls the canonical scheduler list (admin-managed via the Settings
// page) and returns the first row whose facility matches the patient's
// facility, case-insensitive trim. Returns { scheduler: null,
// source: "missing" } when no row matches — the runtime fallback
// (autoAssignSchedulerForExecutionCase capacity fan-out) still gets a
// chance to pick later, but the chip/log will read "Unassigned /
// Engagement Queue" until an admin adds a scheduler row.
export async function lookupSchedulerFromSettings(
  facility: string | null | undefined,
): Promise<SchedulerSettingsLookupResult> {
  const normalizedFacility = (facility ?? "").trim();
  if (!normalizedFacility) {
    return { scheduler: null, source: "missing", facility: null };
  }
  try {
    const schedulers = await storage.getOutreachSchedulers();
    const target = normalizedFacility.toLowerCase();
    const match = schedulers.find(
      (s) => (s.facility ?? "").trim().toLowerCase() === target,
    );
    if (match) {
      return {
        scheduler: match,
        source: "outreach-schedulers-table",
        facility: normalizedFacility,
      };
    }
    // SOURCE MARKER: Scheduler settings source missing; using current scheduler runtime fallback
    return { scheduler: null, source: "missing", facility: normalizedFacility };
  } catch {
    return { scheduler: null, source: "missing", facility: normalizedFacility };
  }
}
