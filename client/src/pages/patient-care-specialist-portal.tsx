// Patient Care Specialist Workspace.
//
// This is one of the two team-member workspaces. It is intentionally
// NOT Outreach / Engagement Center — the standalone Outreach surface is
// available separately at /engagement-center.
//
// Both team-member workspaces (Patient Care Specialist + Ancillary Care
// Specialist) share the same shell architecture provided by
// ClinicWorkflowPortal → PortalShell. Workspace-specific customization
// (default right-panel mode, visible label) is applied at the
// ClinicWorkflowPortal boundary; internals stay unchanged in this batch.

import ClinicWorkflowPortal from "@/components/workflow/ClinicWorkflowPortal";

export default function PatientCareSpecialistPortalPage() {
  return <ClinicWorkflowPortal role="patientCareSpecialist" />;
}
