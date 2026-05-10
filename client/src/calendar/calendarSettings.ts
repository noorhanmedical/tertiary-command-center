// Calendar profile settings resolver.
//
// Code (calendarProfiles.ts) owns the universe of allowed filters, dimensions,
// and add actions. admin_settings rows can override which of those allowed
// values are visible/default per profile, with global / facility / user /
// user+facility scopes. This module performs that merge as a pure function;
// no server calls live here.
//
// admin_settings shape (existing canonical table):
//   settingDomain = "global_schedule"
//   settingKey    = "calendar_profiles"
//   settingValue  = { profiles: { [profileId]: CalendarProfileSettingsOverride } }
//   facilityId    optional
//   userId        optional
//   active        boolean
//
// Backend wiring is a later batch. This file is the deterministic resolver.

import type { CalendarContext, CalendarViewMode } from "./calendarEventTypes";
import {
  CALENDAR_FILTER_IDS,
  type CalendarFilterId,
} from "./calendarFilters";
import {
  CALENDAR_ADD_ACTION_IDS,
  CALENDAR_PROFILES,
  type CalendarAddActionId,
  type CalendarProfile,
  type CalendarProfileId,
} from "./calendarProfiles";

export const CALENDAR_SETTINGS_DOMAIN = "global_schedule";
export const CALENDAR_SETTINGS_KEY = "calendar_profiles";

export type CalendarProfileSettingsOverride = {
  profileId: CalendarProfileId;
  enabledFilters?: CalendarFilterId[];
  defaultFilters?: CalendarFilterId[];
  hiddenFilters?: CalendarFilterId[];
  addActions?: CalendarAddActionId[];
  defaultView?: CalendarViewMode;
  allowFacilityOverride?: boolean;
  allowAllFacilities?: boolean;
  allowPhysicianClinicianFilter?: boolean;
  allowTeamMemberFilter?: boolean;
};

export type CalendarAdminSettingLike = {
  settingDomain: string;
  settingKey: string;
  settingValue: unknown;
  facilityId?: string | null;
  userId?: string | null;
  active?: boolean;
};

const VALID_FILTER_SET: ReadonlySet<CalendarFilterId> = new Set(CALENDAR_FILTER_IDS);
const VALID_ADD_ACTION_SET: ReadonlySet<CalendarAddActionId> = new Set(
  CALENDAR_ADD_ACTION_IDS,
);

function isFilterId(v: unknown): v is CalendarFilterId {
  return typeof v === "string" && VALID_FILTER_SET.has(v as CalendarFilterId);
}

function isAddActionId(v: unknown): v is CalendarAddActionId {
  return typeof v === "string" && VALID_ADD_ACTION_SET.has(v as CalendarAddActionId);
}

function asFilterArray(v: unknown): CalendarFilterId[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CalendarFilterId[] = [];
  for (const item of v) if (isFilterId(item)) out.push(item);
  return out;
}

function asAddActionArray(v: unknown): CalendarAddActionId[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: CalendarAddActionId[] = [];
  for (const item of v) if (isAddActionId(item)) out.push(item);
  return out;
}

function asViewMode(v: unknown): CalendarViewMode | undefined {
  if (v === "month" || v === "week" || v === "day" || v === "agenda") return v;
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function extractOverrideForProfile(
  setting: CalendarAdminSettingLike,
  profileId: CalendarProfileId,
): CalendarProfileSettingsOverride | null {
  if (setting.settingDomain !== CALENDAR_SETTINGS_DOMAIN) return null;
  if (setting.settingKey !== CALENDAR_SETTINGS_KEY) return null;
  if (setting.active === false) return null;

  const value = setting.settingValue;
  if (!value || typeof value !== "object") return null;
  const profiles = (value as { profiles?: unknown }).profiles;
  if (!profiles || typeof profiles !== "object") return null;
  const raw = (profiles as Record<string, unknown>)[profileId];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: CalendarProfileSettingsOverride = { profileId };
  const enabled = asFilterArray(r.enabledFilters);
  if (enabled) out.enabledFilters = enabled;
  const def = asFilterArray(r.defaultFilters);
  if (def) out.defaultFilters = def;
  const hidden = asFilterArray(r.hiddenFilters);
  if (hidden) out.hiddenFilters = hidden;
  const addActions = asAddActionArray(r.addActions);
  if (addActions) out.addActions = addActions;
  const view = asViewMode(r.defaultView);
  if (view) out.defaultView = view;
  const afo = asBool(r.allowFacilityOverride);
  if (afo !== undefined) out.allowFacilityOverride = afo;
  const aaf = asBool(r.allowAllFacilities);
  if (aaf !== undefined) out.allowAllFacilities = aaf;
  const apc = asBool(r.allowPhysicianClinicianFilter);
  if (apc !== undefined) out.allowPhysicianClinicianFilter = apc;
  const atm = asBool(r.allowTeamMemberFilter);
  if (atm !== undefined) out.allowTeamMemberFilter = atm;
  return out;
}

function settingScopeRank(
  setting: CalendarAdminSettingLike,
  context: CalendarContext,
): number {
  // Higher rank wins. Order: global < user < facility < user+facility.
  const hasUser =
    !!setting.userId &&
    !!context.userId &&
    setting.userId === context.userId;
  const hasFacility =
    !!setting.facilityId &&
    !!context.facilityId &&
    setting.facilityId === context.facilityId;
  const isGlobal = !setting.userId && !setting.facilityId;
  if (hasUser && hasFacility) return 4;
  if (hasFacility && !setting.userId) return 3;
  if (hasUser && !setting.facilityId) return 2;
  if (isGlobal) return 1;
  return 0; // not applicable to this context
}

function applyOverride(
  base: CalendarProfile,
  override: CalendarProfileSettingsOverride,
): CalendarProfile {
  // Start from the profile under construction. Setting cannot enable a
  // filter outside the base profile's availableFilters unless the base
  // profile is manager/admin (which already include the full universe).
  const isManagerOrAdmin = base.id === "manager" || base.id === "admin";
  const baseAllowed = new Set(base.availableFilters);

  const next: CalendarProfile = { ...base };

  if (override.enabledFilters) {
    const filtered = override.enabledFilters.filter((f) =>
      isManagerOrAdmin ? VALID_FILTER_SET.has(f) : baseAllowed.has(f),
    );
    next.availableFilters = filtered;
  }

  if (override.hiddenFilters && override.hiddenFilters.length > 0) {
    const hidden = new Set(override.hiddenFilters);
    next.availableFilters = next.availableFilters.filter((f) => !hidden.has(f));
  }

  if (override.defaultFilters) {
    const allowed = new Set(next.availableFilters);
    next.defaultFilters = override.defaultFilters.filter((f) => allowed.has(f));
  } else {
    // Re-derive defaults if any availableFilter was removed.
    const allowed = new Set(next.availableFilters);
    next.defaultFilters = next.defaultFilters.filter((f) => allowed.has(f));
  }

  if (override.addActions) {
    next.addActions = override.addActions.filter((a) =>
      VALID_ADD_ACTION_SET.has(a),
    );
  }

  if (override.defaultView) next.defaultView = override.defaultView;
  if (override.allowFacilityOverride !== undefined)
    next.allowFacilityOverride = override.allowFacilityOverride;
  if (override.allowAllFacilities !== undefined)
    next.allowAllFacilities = override.allowAllFacilities;
  if (override.allowPhysicianClinicianFilter !== undefined)
    next.allowPhysicianClinicianFilter = override.allowPhysicianClinicianFilter;
  if (override.allowTeamMemberFilter !== undefined)
    next.allowTeamMemberFilter = override.allowTeamMemberFilter;

  return next;
}

export function resolveCalendarProfileSettings(
  profileId: CalendarProfileId,
  context: CalendarContext,
  settings: CalendarAdminSettingLike[] = [],
): CalendarProfile {
  const base = CALENDAR_PROFILES[profileId];
  if (!base) {
    throw new Error(`Unknown calendar profile id: ${profileId}`);
  }

  // Sort applicable settings by ascending rank so higher-precedence overrides
  // apply last.
  const ranked = settings
    .map((s) => ({ s, rank: settingScopeRank(s, context) }))
    .filter((r) => r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  let resolved = base;
  for (const { s } of ranked) {
    const override = extractOverrideForProfile(s, profileId);
    if (override) resolved = applyOverride(resolved, override);
  }
  return resolved;
}
