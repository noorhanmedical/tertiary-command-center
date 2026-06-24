import { getSetting, setSetting } from "../../dbSettings";
import {
  DEFAULT_CALL_CONFIG,
  callConfigSchema,
  type EngagementCallConfig,
  type CallConfigPatch,
  type WorkdayTier,
} from "@shared/schema";

// Global, admin-configurable Engagement call-distribution config. Persisted as
// a single JSON blob in the existing key/value app_settings store so it
// survives refresh and is never localStorage-only. Defaults are applied when
// unset or when a stored blob fails validation, so reads are always safe.
const CONFIG_KEY = "engagement.callConfig";

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000, Math.round(n)));
}

// Normalize a config so invariants always hold: percents clamped, visit +
// outreach always sum to 100 (visit is the source of truth), tiers deduped by
// workday %, clamped, and sorted high → low.
export function normalizeCallConfig(input: EngagementCallConfig): EngagementCallConfig {
  const visit = clampPct(input.defaultVisitCallPercent);
  const tierMap = new Map<number, WorkdayTier>();
  for (const t of input.workdayTiers ?? []) {
    const wp = clampPct(t.workdayPercent);
    tierMap.set(wp, { workdayPercent: wp, completedCallKpi: clampCount(t.completedCallKpi) });
  }
  const workdayTiers = Array.from(tierMap.values()).sort(
    (a, b) => b.workdayPercent - a.workdayPercent,
  );
  return {
    fullDayCompletedCallTarget: clampCount(input.fullDayCompletedCallTarget),
    scheduledPatientTargetPercent: clampPct(input.scheduledPatientTargetPercent),
    defaultVisitCallPercent: visit,
    defaultOutreachCallPercent: 100 - visit,
    roundingMode: input.roundingMode,
    workdayTiers,
  };
}

export async function getCallConfig(): Promise<EngagementCallConfig> {
  const raw = await getSetting(CONFIG_KEY);
  if (!raw) return DEFAULT_CALL_CONFIG;
  try {
    const parsed = callConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_CALL_CONFIG;
    return normalizeCallConfig(parsed.data);
  } catch {
    return DEFAULT_CALL_CONFIG;
  }
}

export async function setCallConfig(patch: CallConfigPatch): Promise<EngagementCallConfig> {
  const current = await getCallConfig();
  const merged: EngagementCallConfig = {
    ...current,
    ...patch,
    // Tiers replace wholesale when provided (the editor sends the full list).
    workdayTiers: patch.workdayTiers ?? current.workdayTiers,
  };
  const next = normalizeCallConfig(merged);
  await setSetting(CONFIG_KEY, JSON.stringify(next));
  return next;
}
