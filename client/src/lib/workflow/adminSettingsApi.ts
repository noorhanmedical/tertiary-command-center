import type { AdminSetting } from "@shared/schema";

// Thin read-only client helper for /api/admin-settings. Writes
// (upsert) stay on the admin settings page where they belong; this
// helper covers list + effective-value lookups for surfaces that
// want to *display* a setting without re-implementing the canonical
// precedence (facility,user) → (facility,NULL) → (NULL,user) →
// (NULL,NULL).

export type AdminSettingFilters = {
  settingDomain?: string;
  settingKey?: string;
  facilityId?: string;
  userId?: string;
  active?: boolean;
  limit?: number;
};

function buildQuery(
  filters: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchAdminSettings(
  filters: AdminSettingFilters = {},
): Promise<AdminSetting[]> {
  const res = await fetch(`/api/admin-settings${buildQuery(filters)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`fetchAdminSettings failed (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as AdminSetting[]) : [];
}

export type AdminSettingEffectiveResponse = {
  settingDomain: string;
  settingKey: string;
  facilityId: string | null;
  userId: string | null;
  settingValue: unknown;
};

export async function fetchAdminSettingEffective(args: {
  settingDomain: string;
  settingKey: string;
  facilityId?: string;
  userId?: string;
}): Promise<AdminSettingEffectiveResponse> {
  const res = await fetch(
    `/api/admin-settings/effective${buildQuery(args)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(`fetchAdminSettingEffective failed (${res.status})`);
  }
  return (await res.json()) as AdminSettingEffectiveResponse;
}

// Generic typed reader on top of the effective endpoint — returns
// the `settingValue` typed as T (or null when the row is absent).
export async function readAdminSettingValue<T>(args: {
  settingDomain: string;
  settingKey: string;
  facilityId?: string;
  userId?: string;
}): Promise<T | null> {
  const resp = await fetchAdminSettingEffective(args);
  return (resp.settingValue ?? null) as T | null;
}
