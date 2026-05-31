// Canonical team-member workspace profile shape.
//
// Stored in admin_settings rows keyed by:
//   settingDomain = "team_member"
//   settingKey    = "workspace_profile"
//   userId        = <user id>
//
// No new database table is needed — the admin_settings table already
// supports scoped settings per user (and optionally per facility).
//
// Capabilities:
//   - callAndSchedule          → both PCS and ACS may toggle on.
//   - completeProcedure        → ACS-only at runtime, even if toggled on
//                                for a PCS-typed profile (defense-in-depth).
//   - primaryConsentScreening  → ACS-only at runtime, same gating.
//   - uploadProcedureReport    → ACS-only at runtime, same gating.
//   - viewAllFacilities        → when true, omits the assignedFacilityIds
//                                allow-list and lets the user see any
//                                facility their workspace endpoints return.

export const TEAM_MEMBER_WORKSPACE_TYPES = [
  "patientCareSpecialist",
  "ancillaryCareSpecialist",
] as const;

export type TeamMemberWorkspaceType =
  (typeof TEAM_MEMBER_WORKSPACE_TYPES)[number];

export const TEAM_MEMBER_WORKSPACE_MODES = [
  "clinicSchedule",
  "ancillarySchedule",
  "callList",
] as const;

export type TeamMemberWorkspaceMode =
  (typeof TEAM_MEMBER_WORKSPACE_MODES)[number];

export const TEAM_MEMBER_CAPABILITY_IDS = [
  "callAndSchedule",
  "completeProcedure",
  "primaryConsentScreening",
  "uploadProcedureReport",
  "viewAllFacilities",
] as const;

export type TeamMemberCapabilityId =
  (typeof TEAM_MEMBER_CAPABILITY_IDS)[number];

export type TeamMemberProfileSetting = {
  workspaceType: TeamMemberWorkspaceType;
  assignedFacilityIds: string[];
  defaultFacilityId?: string | null;
  defaultMode?: TeamMemberWorkspaceMode;
  capabilities: Partial<Record<TeamMemberCapabilityId, boolean>>;
  allowedServiceTypes?: string[];
  active?: boolean;
};

export const TEAM_MEMBER_SETTINGS_DOMAIN = "team_member";
export const TEAM_MEMBER_SETTINGS_KEY = "workspace_profile";

export const defaultPatientCareSpecialistProfile: TeamMemberProfileSetting = {
  workspaceType: "patientCareSpecialist",
  assignedFacilityIds: [],
  defaultFacilityId: null,
  defaultMode: "callList",
  capabilities: {
    callAndSchedule: true,
    completeProcedure: false,
    primaryConsentScreening: false,
    uploadProcedureReport: false,
    viewAllFacilities: false,
  },
  allowedServiceTypes: [],
  active: true,
};

export const defaultAncillaryCareSpecialistProfile: TeamMemberProfileSetting = {
  workspaceType: "ancillaryCareSpecialist",
  assignedFacilityIds: [],
  defaultFacilityId: null,
  defaultMode: "clinicSchedule",
  capabilities: {
    callAndSchedule: true,
    completeProcedure: true,
    primaryConsentScreening: true,
    uploadProcedureReport: true,
    viewAllFacilities: false,
  },
  allowedServiceTypes: [],
  active: true,
};

const VALID_WORKSPACE_TYPES = new Set<TeamMemberWorkspaceType>(
  TEAM_MEMBER_WORKSPACE_TYPES,
);
const VALID_MODES = new Set<TeamMemberWorkspaceMode>(TEAM_MEMBER_WORKSPACE_MODES);
const VALID_CAPABILITIES = new Set<TeamMemberCapabilityId>(
  TEAM_MEMBER_CAPABILITY_IDS,
);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = asString(item);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// Defensive normalizer — accepts any JSON blob and returns a valid profile.
// Caller supplies the fallback workspaceType used when the stored value is
// missing or invalid (e.g. derived from the user's role: scheduler →
// patientCareSpecialist, technician/liaison → ancillaryCareSpecialist).
export function normalizeTeamMemberProfile(
  input: unknown,
  fallbackWorkspaceType: TeamMemberWorkspaceType,
): TeamMemberProfileSetting {
  const base =
    fallbackWorkspaceType === "ancillaryCareSpecialist"
      ? defaultAncillaryCareSpecialistProfile
      : defaultPatientCareSpecialistProfile;

  if (!input || typeof input !== "object") {
    return { ...base, capabilities: { ...base.capabilities } };
  }

  const raw = input as Record<string, unknown>;

  const workspaceType = VALID_WORKSPACE_TYPES.has(
    raw.workspaceType as TeamMemberWorkspaceType,
  )
    ? (raw.workspaceType as TeamMemberWorkspaceType)
    : fallbackWorkspaceType;

  const assignedFacilityIds = asStringArray(raw.assignedFacilityIds);
  const defaultFacilityIdRaw = asString(raw.defaultFacilityId);

  const defaultMode = VALID_MODES.has(raw.defaultMode as TeamMemberWorkspaceMode)
    ? (raw.defaultMode as TeamMemberWorkspaceMode)
    : base.defaultMode;

  const capRaw =
    raw.capabilities && typeof raw.capabilities === "object"
      ? (raw.capabilities as Record<string, unknown>)
      : {};
  const capabilities: Partial<Record<TeamMemberCapabilityId, boolean>> = {
    ...base.capabilities,
  };
  for (const key of Object.keys(capRaw)) {
    if (!VALID_CAPABILITIES.has(key as TeamMemberCapabilityId)) continue;
    const v = asBool(capRaw[key]);
    if (v !== undefined) {
      capabilities[key as TeamMemberCapabilityId] = v;
    }
  }

  const viewAll = !!capabilities.viewAllFacilities;
  let defaultFacilityId = defaultFacilityIdRaw;
  if (defaultFacilityId && !viewAll && assignedFacilityIds.length > 0) {
    if (!assignedFacilityIds.includes(defaultFacilityId)) {
      defaultFacilityId = null;
    }
  }

  const allowedServiceTypes = asStringArray(raw.allowedServiceTypes);
  const active = asBool(raw.active);

  return {
    workspaceType,
    assignedFacilityIds,
    defaultFacilityId,
    defaultMode,
    capabilities,
    allowedServiceTypes,
    active: active ?? true,
  };
}

// Map a user `role` to the most sensible fallback workspace type when no
// profile setting exists yet for the user.
export function fallbackWorkspaceTypeForRole(
  role: string | null | undefined,
): TeamMemberWorkspaceType {
  if (role === "technician" || role === "liaison") return "ancillaryCareSpecialist";
  return "patientCareSpecialist";
}
