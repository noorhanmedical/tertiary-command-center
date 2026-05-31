// Ancillary Care Specialist Workspace.
//
// Consolidates the former Technician and Liaison portal capabilities into
// a single team-member workspace. Shares its shell with the Patient Care
// Specialist Workspace at /patient-care-specialist-portal via
// ClinicWorkflowPortal → PortalShell. Default right-panel mode is
// Clinic Schedule; future right-panel modes (Ancillary Schedule, Call
// List) are wired in a follow-up batch.

import ClinicWorkflowPortal from "@/components/workflow/ClinicWorkflowPortal";

export default function AncillaryCareSpecialistPortalPage() {
  return <ClinicWorkflowPortal role="ancillaryCareSpecialist" />;
}
