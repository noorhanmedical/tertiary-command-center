// exceptionSettingsApi — Phase 3 PR 3.1 client.

import type {
  EffectiveExceptionPolicy, DetectorDefinition,
} from "../../../shared/contracts/exceptionIntelligence";
export type {
  EffectiveExceptionPolicy, DetectorDefinition, ExceptionType, ExceptionSeverity, ExceptionOwnerRole,
} from "../../../shared/contracts/exceptionIntelligence";

export type ExceptionSettingsRow = {
  id: number;
  settingDomain: string;
  settingKey: string;
  settingValue: Record<string, unknown>;
  description: string | null;
  facilityId: string | null;
  userId: string | null;
  testType: string | null;
  active: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchEffectiveExceptionPolicy(scope: { facilityId?: string | null; testType?: string | null } = {}): Promise<{ policy: EffectiveExceptionPolicy; registry: DetectorDefinition[] }> {
  const qs = new URLSearchParams();
  if (scope.facilityId) qs.set("facilityId", scope.facilityId);
  if (scope.testType) qs.set("testType", scope.testType);
  const res = await fetch(`/api/exception-settings/effective${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow(res);
}

export async function fetchExceptionSettings(filters: { facilityId?: string; testType?: string; settingKey?: string } = {}): Promise<ExceptionSettingsRow[]> {
  const qs = new URLSearchParams();
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.testType) qs.set("testType", filters.testType);
  if (filters.settingKey) qs.set("settingKey", filters.settingKey);
  const res = await fetch(`/api/exception-settings/settings${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<ExceptionSettingsRow[]>(res);
}

export async function patchExceptionSetting(id: number, patch: { settingValue?: Record<string, unknown>; active?: boolean; description?: string | null }): Promise<ExceptionSettingsRow> {
  const res = await fetch(`/api/exception-settings/settings/${id}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  });
  return jsonOrThrow<ExceptionSettingsRow>(res);
}

export async function createExceptionSetting(input: { settingKey: string; settingValue: Record<string, unknown>; facilityId?: string | null; testType?: string | null; description?: string | null }): Promise<ExceptionSettingsRow> {
  const res = await fetch(`/api/exception-settings/settings`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return jsonOrThrow<ExceptionSettingsRow>(res);
}
