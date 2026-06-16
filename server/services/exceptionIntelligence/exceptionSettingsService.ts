// exceptionSettingsService — Phase 3 PR 3.1.
//
// Resolves the effective exception policy for a (facility, testType)
// scope by reading admin_settings.exception_intelligence.* keys.
// Uses the Phase 2 hardening getAdminSettingValue precedence
// (testType > facility > user > global > default).

import { getAdminSettingValue } from "../../repositories/adminSettings.repo";
import {
  DETECTOR_REGISTRY,
  getDetectorByType,
} from "./detectorRegistry";
import type {
  EffectiveExceptionPolicy,
  EffectiveDetectorPolicy,
  ExceptionSeverity,
  ExceptionOwnerRole,
  ExceptionType,
} from "@shared/contracts/exceptionIntelligence";
import {
  EXCEPTION_INTELLIGENCE_DOMAIN as DOMAIN,
  EXCEPTION_GLOBAL_KEYS,
} from "@shared/contracts/exceptionIntelligence";

type Scope = { facilityId: string | null; userId: string | null; testType: string | null };
type SourceLabel = "test_type" | "facility" | "user" | "global" | "default";

async function readWithSource<T>(key: string, scope: Scope): Promise<{ value: T | null; source: SourceLabel }> {
  if (scope.testType != null) {
    const ts = await getAdminSettingValue<T>(DOMAIN, key, {
      facilityId: scope.facilityId ?? null,
      userId: scope.userId ?? null,
      testType: scope.testType,
    });
    if (ts !== null) return { value: ts, source: "test_type" };
  }
  if (scope.facilityId != null) {
    const fs = await getAdminSettingValue<T>(DOMAIN, key, { facilityId: scope.facilityId });
    if (fs !== null) return { value: fs, source: "facility" };
  }
  if (scope.userId != null) {
    const us = await getAdminSettingValue<T>(DOMAIN, key, { userId: scope.userId });
    if (us !== null) return { value: us, source: "user" };
  }
  const g = await getAdminSettingValue<T>(DOMAIN, key);
  if (g !== null) return { value: g, source: "global" };
  return { value: null, source: "default" };
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}
function asBoolean(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1" || v === "yes";
  return fallback;
}
function asString<T extends string>(v: unknown, fallback: T): T {
  if (typeof v === "string") return v as T;
  return fallback;
}

export async function getEffectiveExceptionPolicy(
  scope: { facilityId?: string | null; userId?: string | null; testType?: string | null } = {},
): Promise<EffectiveExceptionPolicy> {
  const s: Scope = {
    facilityId: scope.facilityId ?? null,
    userId: scope.userId ?? null,
    testType: scope.testType ?? null,
  };
  const sources: Record<string, SourceLabel> = {};
  const detectors: Partial<Record<ExceptionType, EffectiveDetectorPolicy>> = {};

  for (const def of DETECTOR_REGISTRY) {
    const thresholdRead = await readWithSource<{ value: unknown }>(def.thresholdSettingKey, s);
    sources[def.thresholdSettingKey] = thresholdRead.source;
    const severityRead = await readWithSource<{ value: unknown }>(`${def.exceptionType}_severity`, s);
    sources[`${def.exceptionType}_severity`] = severityRead.source;
    const ownerRead = await readWithSource<{ value: unknown }>(`${def.exceptionType}_owner_role`, s);
    sources[`${def.exceptionType}_owner_role`] = ownerRead.source;

    const rawThreshold = (thresholdRead.value as { value?: unknown } | null)?.value;
    const rawSeverity = (severityRead.value as { value?: unknown } | null)?.value;
    const rawOwner = (ownerRead.value as { value?: unknown } | null)?.value;

    detectors[def.exceptionType] = {
      exceptionType: def.exceptionType,
      severity: asString(rawSeverity, def.defaultSeverity) as ExceptionSeverity,
      ownerRole: asString(rawOwner, def.defaultOwnerRole) as ExceptionOwnerRole,
      thresholdValue: asNumber(rawThreshold, def.defaultThresholdValue),
      thresholdUnit: def.thresholdUnit,
      source: thresholdRead.source,
    };
  }

  // Global Phase 3 safety flags.
  const hrr = await readWithSource<{ value?: boolean }>(EXCEPTION_GLOBAL_KEYS.humanReviewRequired, s);
  const aae = await readWithSource<{ value?: boolean }>(EXCEPTION_GLOBAL_KEYS.autoActionsEnabled, s);
  sources[EXCEPTION_GLOBAL_KEYS.humanReviewRequired] = hrr.source;
  sources[EXCEPTION_GLOBAL_KEYS.autoActionsEnabled] = aae.source;

  return {
    scope: { facilityId: s.facilityId, testType: s.testType },
    detectors: detectors as Record<ExceptionType, EffectiveDetectorPolicy>,
    humanReviewRequired: asBoolean(hrr.value?.value, true),
    // Phase 3 absolute rule: even when a setting says true, the
    // route layer never executes — the flag exists for future PRs.
    autoActionsEnabled: asBoolean(aae.value?.value, false),
    sources,
  };
}

export function getDetectorRegistrySnapshot() {
  return DETECTOR_REGISTRY;
}

export { EXCEPTION_INTELLIGENCE_DOMAIN } from "@shared/contracts/exceptionIntelligence";
export { getDetectorByType };
