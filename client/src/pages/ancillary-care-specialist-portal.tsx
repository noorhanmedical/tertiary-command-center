// Ancillary Care Specialist Workspace — LIVE Team Portal.
//
// Mounts ClinicWorkflowPortal → TeamPortalShell (the real 3,973-line
// interactive shell with slide-away/hover-peek rails, pin toggles,
// view-as, multi-tab workspaces, tool dock, floating widgets,
// communication tray, invoice desk, calls repository, and
// backend-persisted widget/layout prefs via /api/portal/widgets and
// /api/portal/workspace-prefs).
//
// IMPORTANT: This route must never mount TeamMemberPortalPlayground.
// That file is a static, unwired mockup/design reference kept for
// visual experimentation only. Any visual experiment must live on a
// separate preview route, not here.

// Phase 2I — when VITE_FEATURE_ACS_CANONICAL_VIEW is ON, render the canonical
// ACS stage-vector view instead of the legacy shell. Flag OFF (the default)
// renders the exact legacy workspace and issues ZERO canonical requests.
import ClinicWorkflowPortal from "@/components/workflow/ClinicWorkflowPortal";
import { isAcsCanonicalViewEnabled } from "@/lib/acsCanonicalViewFlag";
import { CanonicalAcsPage } from "@/components/careSpecialist/CanonicalAcsPage";

export default function AncillaryCareSpecialistPortalPage() {
  if (isAcsCanonicalViewEnabled()) {
    return <CanonicalAcsPage />;
  }
  return <ClinicWorkflowPortal role="ancillaryCareSpecialist" />;
}
