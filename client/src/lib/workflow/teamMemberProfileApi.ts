// Client helpers for the team-member workspace profile stored in
// admin_settings (settingDomain="team_member", settingKey="workspace_profile",
// userId=<user id>). All helpers wrap existing /api/admin-settings routes;
// no new backend routes are required.

import { apiRequest } from "@/lib/queryClient";
import {
  TEAM_MEMBER_SETTINGS_DOMAIN,
  TEAM_MEMBER_SETTINGS_KEY,
  fallbackWorkspaceTypeForRole,
  normalizeTeamMemberProfile,
  type TeamMemberProfileSetting,
  type TeamMemberWorkspaceType,
} from "@shared/teamMemberProfile";

export type {
  TeamMemberProfileSetting,
  TeamMemberWorkspaceType,
} from "@shared/teamMemberProfile";

// Resolve the effective profile for a user via the existing
// `/api/admin-settings/effective` scope-precedence reader. Falls back to a
// role-derived default when no row exists.
export async function fetchTeamMemberProfile(
  userId: string,
  fallbackRole?: string | null,
): Promise<TeamMemberProfileSetting> {
  const url = new URL("/api/admin-settings/effective", window.location.origin);
  url.searchParams.set("settingDomain", TEAM_MEMBER_SETTINGS_DOMAIN);
  url.searchParams.set("settingKey", TEAM_MEMBER_SETTINGS_KEY);
  url.searchParams.set("userId", userId);
  const res = await fetch(url.pathname + url.search, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load team-member profile (${res.status})`);
  }
  const body = (await res.json()) as { settingValue?: unknown };
  return normalizeTeamMemberProfile(
    body?.settingValue,
    fallbackWorkspaceTypeForRole(fallbackRole),
  );
}

export async function saveTeamMemberProfile(
  userId: string,
  profile: TeamMemberProfileSetting,
): Promise<TeamMemberProfileSetting> {
  const res = await apiRequest("POST", "/api/admin-settings/upsert", {
    settingDomain: TEAM_MEMBER_SETTINGS_DOMAIN,
    settingKey: TEAM_MEMBER_SETTINGS_KEY,
    userId,
    settingValue: profile,
    active: profile.active ?? true,
    description: "Team member workspace profile",
  });
  const body = (await res.json()) as { settingValue?: unknown };
  return normalizeTeamMemberProfile(
    body?.settingValue,
    profile.workspaceType,
  );
}

export type AdminSettingRowLike = {
  id: number;
  settingDomain: string;
  settingKey: string;
  settingValue: unknown;
  userId: string | null;
  facilityId: string | null;
  active: boolean;
};

export async function fetchAllTeamMemberProfileSettings(): Promise<AdminSettingRowLike[]> {
  const url = new URL("/api/admin-settings", window.location.origin);
  url.searchParams.set("settingDomain", TEAM_MEMBER_SETTINGS_DOMAIN);
  url.searchParams.set("settingKey", TEAM_MEMBER_SETTINGS_KEY);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "500");
  const res = await fetch(url.pathname + url.search, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to load team-member profile settings (${res.status})`);
  }
  const body = (await res.json()) as AdminSettingRowLike[];
  return Array.isArray(body) ? body : [];
}
