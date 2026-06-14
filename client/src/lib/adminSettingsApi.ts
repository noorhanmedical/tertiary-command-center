// Thin typed client for the /api/admin-settings/* routes.
//
// PR 2.1 — the Admin Settings Center page consumes these helpers.
// Runtime services consume the server-side
// adminSettingsEffectiveService directly; the client only reads.

export type AdminSettingRow = {
  id: number;
  settingDomain: string;
  settingKey: string;
  settingValue: Record<string, unknown>;
  description: string | null;
  facilityId: string | null;
  userId: string | null;
  active: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type EffectiveAdminSettingsBundle = {
  scope: { facilityId: string | null; userId: string | null };
  callResult: {
    callbackDueHours: number;
    noAnswerCallbackHours: number;
    voicemailCallbackHours: number;
    managerReviewRequiresTask: boolean;
    preserveSchedulerOwnership: boolean;
    maxCallAttempts: number;
    dncIsTerminal: boolean;
    declinedIsTerminal: boolean;
    readyToScheduleRoutesToTriage: boolean;
    scheduledClosesAssignment: boolean;
    queueReentryEnabled: boolean;
  };
  scheduling: {
    globalScheduleIsSourceOfTruth: boolean;
    ptoBlocksAssignment: boolean;
    sameDayAddAllowedIfCapacity: boolean;
  };
  assignment: {
    schedulerAutoAssignEnabled: boolean;
    pcsAssignmentRespectsFacilityScope: boolean;
    acsAssignmentRespectsFacilityScope: boolean;
  };
  sources: Record<string, "facility" | "user" | "global" | "default">;
};

async function jsonOrThrow<T>(res: Response, fallback?: T): Promise<T> {
  if (res.status === 404 && fallback !== undefined) return fallback;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchAdminSettings(filters: {
  settingDomain?: string;
  settingKey?: string;
  active?: boolean;
} = {}): Promise<AdminSettingRow[]> {
  const qs = new URLSearchParams();
  if (filters.settingDomain) qs.set("settingDomain", filters.settingDomain);
  if (filters.settingKey) qs.set("settingKey", filters.settingKey);
  if (filters.active !== undefined) qs.set("active", String(filters.active));
  const res = await fetch(`/api/admin-settings${qs.toString() ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  return jsonOrThrow<AdminSettingRow[]>(res, []);
}

export async function fetchEffectiveAdminSettings(scope: {
  facilityId?: string | null;
  userId?: string | null;
} = {}): Promise<EffectiveAdminSettingsBundle> {
  const qs = new URLSearchParams();
  if (scope.facilityId) qs.set("facilityId", scope.facilityId);
  if (scope.userId) qs.set("userId", scope.userId);
  const res = await fetch(
    `/api/admin-settings/effective${qs.toString() ? `?${qs}` : ""}`,
    { credentials: "include" },
  );
  return jsonOrThrow<EffectiveAdminSettingsBundle>(res);
}

export async function createAdminSettingRow(input: {
  settingDomain: string;
  settingKey: string;
  settingValue: Record<string, unknown>;
  description?: string | null;
  facilityId?: string | null;
  userId?: string | null;
  active?: boolean;
}): Promise<AdminSettingRow> {
  const res = await fetch("/api/admin-settings", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<AdminSettingRow>(res);
}

export async function patchAdminSettingRow(
  id: number,
  patch: {
    settingValue?: Record<string, unknown>;
    description?: string | null;
    active?: boolean;
  },
): Promise<AdminSettingRow> {
  const res = await fetch(`/api/admin-settings/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<AdminSettingRow>(res);
}

export async function deactivateAdminSettingRow(id: number): Promise<AdminSettingRow> {
  return patchAdminSettingRow(id, { active: false });
}
