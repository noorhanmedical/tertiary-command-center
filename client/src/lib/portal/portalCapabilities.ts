// Centralized PCS/ACS portal capability resolver.
//
// Wraps the existing `TeamMemberProfileSetting.capabilities` map
// into a derived, role-aware set the UI can read without poking
// into the raw profile shape. The resolver enforces the canonical
// rule that procedure-side capabilities require an ACS-typed
// workspace at runtime, even if a PCS profile somehow has the
// capability bit toggled on (defense-in-depth).
//
// Inputs are intentionally minimal — pages pass the profile (or
// null when no profile resolves yet), the canonical workspaceType,
// and any explicit admin override they already have in scope. The
// resolver does NOT fetch — read paths stay on
// `client/src/lib/workflow/teamMemberProfileApi.ts`.

import type {
  TeamMemberProfileSetting,
  TeamMemberWorkspaceType,
} from "@shared/teamMemberProfile";

export type PortalCapabilities = {
  canScheduleClinicVisit: boolean;
  canScheduleAncillary: boolean;
  canAddSameDayAncillary: boolean;
  canMarkProcedureCompleted: boolean;
  canUseCallList: boolean;
  canCreateCallback: boolean;
  canForwardToScheduler: boolean;
  canPrimaryConsentScreening: boolean;
  canUploadProcedureReport: boolean;
  viewAllFacilities: boolean;
};

export type ResolvePortalCapabilitiesInput = {
  workspaceType: TeamMemberWorkspaceType;
  profile?: TeamMemberProfileSetting | null;
  // Explicit admin override — if present, wins over the profile
  // capability bit. Used by the admin override path in the
  // workspace_profile editor where applicable. Each key matches the
  // raw `capabilities` keys, not the resolver output keys.
  adminOverride?: Partial<Record<
    | "callAndSchedule"
    | "completeProcedure"
    | "primaryConsentScreening"
    | "uploadProcedureReport"
    | "viewAllFacilities",
    boolean
  >>;
};

function pick(
  override: boolean | undefined,
  profile: boolean | undefined,
  fallback: boolean,
): boolean {
  if (override !== undefined) return override;
  if (profile !== undefined) return profile;
  return fallback;
}

// Canonical resolver. PCS-typed workspaces never get
// procedure-side capability, even when the profile or override
// claims they do — same gating as the server-side check.
export function resolvePortalCapabilities(
  input: ResolvePortalCapabilitiesInput,
): PortalCapabilities {
  const { workspaceType, profile, adminOverride } = input;
  const caps = profile?.capabilities ?? {};
  const ov = adminOverride ?? {};
  const isAcs = workspaceType === "ancillaryCareSpecialist";

  const callAndSchedule = pick(ov.callAndSchedule, caps.callAndSchedule, true);
  const completeProcedureRaw = pick(
    ov.completeProcedure,
    caps.completeProcedure,
    isAcs,
  );
  const primaryConsentRaw = pick(
    ov.primaryConsentScreening,
    caps.primaryConsentScreening,
    isAcs,
  );
  const uploadReportRaw = pick(
    ov.uploadProcedureReport,
    caps.uploadProcedureReport,
    isAcs,
  );
  const viewAllFacilities = pick(ov.viewAllFacilities, caps.viewAllFacilities, false);

  return {
    // Both PCS and ACS may schedule clinic visits when call/schedule
    // is enabled. The schedule button itself is gated server-side
    // by the user's role/facility scope.
    canScheduleClinicVisit: callAndSchedule,
    // Ancillary scheduling is ACS's primary surface; PCS may also
    // schedule when the facility/workflow allows it (server still
    // arbitrates).
    canScheduleAncillary: callAndSchedule,
    // Same-day ancillary adds are ACS-only by canonical rule.
    canAddSameDayAncillary: isAcs && callAndSchedule,
    // Procedure-side actions require ACS, regardless of profile bit.
    canMarkProcedureCompleted: isAcs && completeProcedureRaw,
    canPrimaryConsentScreening: isAcs && primaryConsentRaw,
    canUploadProcedureReport: isAcs && uploadReportRaw,
    // Call list + callback creation are PCS-primary but available
    // to ACS when callAndSchedule is on.
    canUseCallList: callAndSchedule,
    canCreateCallback: callAndSchedule,
    // Forwarding to the dedicated scheduler is available to both
    // PCS and ACS when callAndSchedule is on.
    canForwardToScheduler: callAndSchedule,
    viewAllFacilities,
  };
}

// Default safe capabilities for a context with no resolved profile.
// PCS-typed read-only access: nothing procedure-side, call+schedule
// permitted (which the server can still refuse).
export function defaultSafePortalCapabilities(
  workspaceType: TeamMemberWorkspaceType,
): PortalCapabilities {
  return resolvePortalCapabilities({ workspaceType, profile: null });
}
