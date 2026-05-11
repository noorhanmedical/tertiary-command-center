import { PortalShell } from "@/components/portal/PortalShell";
import type { TeamMemberWorkspaceMode } from "@/components/portal/WorkspaceModeSwitcher";

// Visible workspace role accepted by the unified team-member shell.
// `technician` and `liaison` remain accepted for legacy direct mounts.
// New surfaces should pass `patientCareSpecialist` or
// `ancillaryCareSpecialist` — these are the user-facing workspace
// concepts.
type WorkspaceRole =
  | "technician"
  | "liaison"
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist";

// Internal data role consumed by PortalShell's existing branching (clinic-
// day workflow vs. outreach-style call list). The user-facing workspace
// is mapped to the closest existing internal role so PortalShell's
// internals stay untouched in this batch:
//   ancillaryCareSpecialist → technician  (clinic-day flow)
//   patientCareSpecialist   → liaison     (call-oriented flow)
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

export default function ClinicWorkflowPortal({
  role,
}: {
  role: WorkspaceRole;
}) {
  return (
    <PortalShell
      role={INTERNAL_ROLE[role]}
      workspaceLabel={WORKSPACE_LABEL[role]}
      defaultMode={DEFAULT_MODE[role]}
      workspaceRole={role}
    />
  );
}
