// Ancillary Care Specialist Portal consolidates technician and liaison
// capabilities into a single team-member portal. It hosts the clinic /
// visit schedule, ancillary schedule, call list, consent + screening form
// completion, procedure completion, uploads, and reports.
//
// In this foundation batch the page is a thin wrapper around the existing
// ClinicWorkflowPortal in technician mode so existing data flows stay
// intact while future batches reshape internals (right-panel modes,
// canonical event hydration, liaison-side capabilities). Old routes
// (/technician-portal, /liaison-technician-portal, /liaison-portal)
// redirect here.

import ClinicWorkflowPortal from "@/components/workflow/ClinicWorkflowPortal";

export default function AncillaryCareSpecialistPortalPage() {
  return <ClinicWorkflowPortal role="technician" />;
}
