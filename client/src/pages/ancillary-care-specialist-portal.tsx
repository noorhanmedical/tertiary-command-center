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
//
// Phase 2I — the canonical ACS stage-vector data is wired INSIDE this shell via
// the flag-gated CanonicalLifecycleSection (see TeamPortalShell). This page always
// renders the exact existing shell; the canonical section renders nothing when
// VITE_FEATURE_ACS_CANONICAL_VIEW is OFF (the default) and issues zero requests.

import ClinicWorkflowPortal from "@/components/workflow/ClinicWorkflowPortal";

export default function AncillaryCareSpecialistPortalPage() {
  return <ClinicWorkflowPortal role="ancillaryCareSpecialist" />;
}
