// billingPolicyApi — Phase 4 PR 4.1 client.

import type { EffectiveBillingPolicy } from "../../../shared/contracts/billingPolicy";
export type { EffectiveBillingPolicy } from "../../../shared/contracts/billingPolicy";

export type BillingPolicyRow = {
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

export async function fetchEffectiveBillingPolicy(scope: {
  facilityId?: string | null;
  testType?: string | null;
} = {}): Promise<EffectiveBillingPolicy> {
  const qs = new URLSearchParams();
  if (scope.facilityId) qs.set("facilityId", scope.facilityId);
  if (scope.testType) qs.set("testType", scope.testType);
  const res = await fetch(`/api/billing-policy/effective${qs.toString() ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  return jsonOrThrow<EffectiveBillingPolicy>(res);
}

export async function fetchBillingPolicySettings(filters: {
  facilityId?: string;
  testType?: string;
  settingKey?: string;
} = {}): Promise<BillingPolicyRow[]> {
  const qs = new URLSearchParams();
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.testType) qs.set("testType", filters.testType);
  if (filters.settingKey) qs.set("settingKey", filters.settingKey);
  const res = await fetch(`/api/billing-policy/settings${qs.toString() ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  return jsonOrThrow<BillingPolicyRow[]>(res);
}

export async function patchBillingPolicy(
  id: number,
  patch: { settingValue?: Record<string, unknown>; active?: boolean; description?: string | null },
): Promise<BillingPolicyRow> {
  const res = await fetch(`/api/billing-policy/settings/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<BillingPolicyRow>(res);
}

export async function createBillingPolicy(input: {
  settingKey: string;
  settingValue: Record<string, unknown>;
  facilityId?: string | null;
  testType?: string | null;
  description?: string | null;
}): Promise<BillingPolicyRow> {
  const res = await fetch(`/api/billing-policy/settings`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<BillingPolicyRow>(res);
}
