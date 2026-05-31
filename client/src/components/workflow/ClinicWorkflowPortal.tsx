import { PortalShell } from "@/components/portal/PortalShell";
import { TeamPortalShell } from "@/components/portal/TeamPortalShell";
import type { TeamMemberWorkspaceMode } from "@/components/portal/WorkspaceModeSwitcher";

// Visible workspace role accepted by the team-member shell adapter.
//
// Legacy direct mounts (`technician`, `liaison`) keep their existing
// experience by routing through the legacy PortalShell.tsx so
// /scheduler-portal, /technician-portal, /liaison-technician-portal
// behave exactly as before.
//
// New surfaces (`patientCareSpecialist`, `ancillaryCareSpecialist`)
// route through TeamPortalShell — the expanded shell with the
// WorkspaceModeSwitcher tab strip, PatientCommandCanvas,
// PatientMiniCalendar, schedule dialogs, the four Portal*Tab files,
// and the CanonicalCommandCalendar drawer.
type WorkspaceRole =
  | "technician"
  | "liaison"
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

// Both shells consume the same internal Role union ("technician" |
// "liaison"). PCS is call-oriented (maps to liaison internals);
// ACS is clinic-day-oriented (maps to technician internals). The
// adapter passes the public role through via `workspaceRole` so the
// shell can gate UI by PCS vs. ACS regardless of internal mapping.
const INTERNAL_ROLE: Record<WorkspaceRole, "technician" | "liaison"> = {
  technician: "technician",
  liaison: "liaison",
  ancillaryCareSpecialist: "technician",
  patientCareSpecialist: "liaison",
};

const WORKSPACE_LABEL: Record<WorkspaceRole, string | undefined> = {
  technician: undefined, // legacy callers keep their existing header label
  liaison: undefined,
  ancillaryCareSpecialist: "Ancillary Care Specialist Workspace",
  patientCareSpecialist: "Patient Care Specialist Workspace",
};

const DEFAULT_MODE: Record<WorkspaceRole, TeamMemberWorkspaceMode> = {
  technician: "clinicSchedule",
  liaison: "callList",
  ancillaryCareSpecialist: "clinicSchedule",
  patientCareSpecialist: "callList",
};

function isTeamMemberWorkspace(role: WorkspaceRole): boolean {
  return role === "patientCareSpecialist" || role === "ancillaryCareSpecialist";
}

export default function ClinicWorkflowPortal({
  role,
}: {
  role: WorkspaceRole;
}) {
  if (isTeamMemberWorkspace(role)) {
    return (
      <TeamPortalShell
        role={INTERNAL_ROLE[role]}
        workspaceLabel={WORKSPACE_LABEL[role]}
        defaultMode={DEFAULT_MODE[role]}
        workspaceRole={role}
      />
    );
  }
  return (
    <PortalShell
      role={INTERNAL_ROLE[role]}
      workspaceLabel={WORKSPACE_LABEL[role]}
      defaultMode={DEFAULT_MODE[role]}
      workspaceRole={role}
    />
  );
}
