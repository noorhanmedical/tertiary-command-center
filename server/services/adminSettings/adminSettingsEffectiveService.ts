// adminSettingsEffectiveService — resolves the effective admin
// settings bundle for a given (facility, user) scope.
//
// The repository already supports per-row scope precedence via
// `getAdminSettingValue(domain, key, { facilityId, userId })`. This
// service wraps it into a typed bundle so the Admin Settings Center
// page + the call-result runtime + the scheduling runtime can read
// one effective object instead of doing N independent lookups.
//
// Precedence (most specific wins):
//   1. facility + user
//   2. facility only
//   3. user only
//   4. global (NULL, NULL)
//   5. compile-time default (last resort)
//
// Test/(test-type) overrides and (facility + test) overrides are
// flagged as "unsupported by current schema" — see
// docs/architecture/phase-2-admin-settings-runtime.md. The current
// admin_settings table has facilityId + userId only, not testType.
// PR 2.1 does not migrate the schema; future phases can add a
// testType column without changing the route shape.

import {
  getAdminSettingValue,
  type AdminSettingScope,
} from "../../repositories/adminSettings.repo";

export type EffectiveCallResultSettings = {
  callbackDueHours: number;
  noAnswerCallbackHours: number;
  voicemailCallbackHours: number;
  managerReviewRequiresTask: boolean;
  preserveSchedulerOwnership: boolean;
  /** PR 2.1 new — drives the unable-to-reach transition. */
  maxCallAttempts: number;
  /** PR 2.1 new — DNC behavior (terminal or transferable to manager_review). */
  dncIsTerminal: boolean;
  /** PR 2.1 new — declined behavior (terminal or callback_window). */
  declinedIsTerminal: boolean;
  /** PR 2.1 new — ready-to-schedule queue routing. */
  readyToScheduleRoutesToTriage: boolean;
  /** PR 2.1 new — scheduled queue routing. */
  scheduledClosesAssignment: boolean;
  /** PR 2.1 new — queue re-entry on callback-style outcomes. */
  queueReentryEnabled: boolean;
};

export type EffectiveSchedulingSettings = {
  globalScheduleIsSourceOfTruth: boolean;
  ptoBlocksAssignment: boolean;
  sameDayAddAllowedIfCapacity: boolean;
};

export type EffectiveAssignmentSettings = {
  schedulerAutoAssignEnabled: boolean;
  pcsAssignmentRespectsFacilityScope: boolean;
  acsAssignmentRespectsFacilityScope: boolean;
};

export type EffectiveAdminSettingsBundle = {
  scope: { facilityId: string | null; userId: string | null; testType: string | null };
  callResult: EffectiveCallResultSettings;
  scheduling: EffectiveSchedulingSettings;
  assignment: EffectiveAssignmentSettings;
  // Source ledger — for the Admin Settings Center to show "facility
  // override" vs "global default" vs "compile-time default" labels.
  sources: Record<string, "test_type" | "facility" | "user" | "global" | "default">;
};

async function readWithSource<T>(
  domain: string,
  key: string,
  scope: AdminSettingScope,
): Promise<{ value: T | null; source: "test_type" | "facility" | "user" | "global" | "default" }> {
  // Phase 2 hardening item 5 — testType precedence (most-specific
  // wins). A row matching the active test takes precedence over a
  // bare facility / user / global default.
  if (scope.testType != null) {
    const testScoped = await getAdminSettingValue<T>(domain, key, {
      facilityId: scope.facilityId ?? null,
      userId: scope.userId ?? null,
      testType: scope.testType,
    });
    if (testScoped !== null) return { value: testScoped, source: "test_type" };
  }
  if (scope.facilityId != null) {
    const facilityScoped = await getAdminSettingValue<T>(domain, key, { facilityId: scope.facilityId });
    if (facilityScoped !== null) return { value: facilityScoped, source: "facility" };
  }
  if (scope.userId != null) {
    const userScoped = await getAdminSettingValue<T>(domain, key, { userId: scope.userId });
    if (userScoped !== null) return { value: userScoped, source: "user" };
  }
  const global = await getAdminSettingValue<T>(domain, key);
  if (global !== null) return { value: global, source: "global" };
  return { value: null, source: "default" };
}

export async function getEffectiveAdminSettings(
  scope: AdminSettingScope = {},
): Promise<EffectiveAdminSettingsBundle> {
  const sources: Record<string, "test_type" | "facility" | "user" | "global" | "default"> = {};

  // Call-result domain
  const callback = await readWithSource<{ hours?: number }>(
    "scheduling_triage",
    "default_callback_due_hours",
    scope,
  );
  const noAnswer = await readWithSource<{ hours?: number }>(
    "engagement_center",
    "no_answer_callback_hours",
    scope,
  );
  const voicemail = await readWithSource<{ hours?: number }>(
    "engagement_center",
    "voicemail_callback_hours",
    scope,
  );
  const mgrReview = await readWithSource<{ required?: boolean }>(
    "scheduling_triage",
    "manager_review_requires_task",
    scope,
  );
  const ownership = await readWithSource<{ enabled?: boolean }>(
    "engagement_center",
    "preserve_scheduler_ownership",
    scope,
  );
  const maxAttempts = await readWithSource<{ count?: number }>(
    "engagement_center",
    "max_call_attempts",
    scope,
  );
  const dncTerminal = await readWithSource<{ terminal?: boolean }>(
    "engagement_center",
    "dnc_is_terminal",
    scope,
  );
  const declinedTerminal = await readWithSource<{ terminal?: boolean }>(
    "engagement_center",
    "declined_is_terminal",
    scope,
  );
  const r2sTriage = await readWithSource<{ routes_to_triage?: boolean }>(
    "engagement_center",
    "ready_to_schedule_routes_to_triage",
    scope,
  );
  const schedClose = await readWithSource<{ closes_assignment?: boolean }>(
    "engagement_center",
    "scheduled_closes_assignment",
    scope,
  );
  const queueReentry = await readWithSource<{ enabled?: boolean }>(
    "engagement_center",
    "queue_reentry_enabled",
    scope,
  );

  sources["scheduling_triage.default_callback_due_hours"] = callback.source;
  sources["engagement_center.no_answer_callback_hours"] = noAnswer.source;
  sources["engagement_center.voicemail_callback_hours"] = voicemail.source;
  sources["scheduling_triage.manager_review_requires_task"] = mgrReview.source;
  sources["engagement_center.preserve_scheduler_ownership"] = ownership.source;
  sources["engagement_center.max_call_attempts"] = maxAttempts.source;
  sources["engagement_center.dnc_is_terminal"] = dncTerminal.source;
  sources["engagement_center.declined_is_terminal"] = declinedTerminal.source;
  sources["engagement_center.ready_to_schedule_routes_to_triage"] = r2sTriage.source;
  sources["engagement_center.scheduled_closes_assignment"] = schedClose.source;
  sources["engagement_center.queue_reentry_enabled"] = queueReentry.source;

  // Scheduling domain
  const gst = await readWithSource<{ enabled?: boolean }>(
    "global_schedule",
    "source_of_truth",
    scope,
  );
  const ptoBlocks = await readWithSource<{ enabled?: boolean }>(
    "global_schedule",
    "pto_blocks_assignment",
    scope,
  );
  const sameDayAdd = await readWithSource<{ enabled?: boolean }>(
    "global_schedule",
    "same_day_add_allowed_if_capacity",
    scope,
  );
  sources["global_schedule.source_of_truth"] = gst.source;
  sources["global_schedule.pto_blocks_assignment"] = ptoBlocks.source;
  sources["global_schedule.same_day_add_allowed_if_capacity"] = sameDayAdd.source;

  // Assignment domain
  const autoAssign = await readWithSource<{ enabled?: boolean }>(
    "assignment",
    "scheduler_auto_assign_enabled",
    scope,
  );
  const pcsScope = await readWithSource<{ enabled?: boolean }>(
    "assignment",
    "pcs_assignment_respects_facility_scope",
    scope,
  );
  const acsScope = await readWithSource<{ enabled?: boolean }>(
    "assignment",
    "acs_assignment_respects_facility_scope",
    scope,
  );
  sources["assignment.scheduler_auto_assign_enabled"] = autoAssign.source;
  sources["assignment.pcs_assignment_respects_facility_scope"] = pcsScope.source;
  sources["assignment.acs_assignment_respects_facility_scope"] = acsScope.source;

  return {
    scope: { facilityId: scope.facilityId ?? null, userId: scope.userId ?? null, testType: scope.testType ?? null },
    callResult: {
      callbackDueHours: callback.value?.hours ?? 24,
      noAnswerCallbackHours: noAnswer.value?.hours ?? 4,
      voicemailCallbackHours: voicemail.value?.hours ?? 4,
      managerReviewRequiresTask: mgrReview.value?.required ?? true,
      preserveSchedulerOwnership: ownership.value?.enabled ?? true,
      maxCallAttempts: maxAttempts.value?.count ?? 6,
      dncIsTerminal: dncTerminal.value?.terminal ?? true,
      declinedIsTerminal: declinedTerminal.value?.terminal ?? true,
      readyToScheduleRoutesToTriage: r2sTriage.value?.routes_to_triage ?? true,
      scheduledClosesAssignment: schedClose.value?.closes_assignment ?? true,
      queueReentryEnabled: queueReentry.value?.enabled ?? true,
    },
    scheduling: {
      globalScheduleIsSourceOfTruth: gst.value?.enabled ?? true,
      ptoBlocksAssignment: ptoBlocks.value?.enabled ?? true,
      sameDayAddAllowedIfCapacity: sameDayAdd.value?.enabled ?? true,
    },
    assignment: {
      schedulerAutoAssignEnabled: autoAssign.value?.enabled ?? false,
      pcsAssignmentRespectsFacilityScope: pcsScope.value?.enabled ?? true,
      acsAssignmentRespectsFacilityScope: acsScope.value?.enabled ?? true,
    },
    sources,
  };
}
