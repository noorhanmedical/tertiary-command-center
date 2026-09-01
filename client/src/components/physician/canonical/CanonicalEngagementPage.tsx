// Phase 2H — canonical Engagement page (flag-ON replacement for the mock-backed
// PlexusEngagementPage body). Renders canonical bounded ancillary-case rows with
// their Engagement list/membership identity. NO mock calls, conversions,
// qualifications, escalations, or outreach history, and NO messaging controls
// (no Twilio/SMS). Preserves Back to Dashboard + the heading.

import { BackToDashboard } from "../ClinicianPortalShell";
import { CanonicalOverviewPanel } from "../CanonicalOverviewPanel";

export function CanonicalEngagementPage() {
  return (
    <div className="space-y-6" data-testid="canonical-engagement-page">
      <BackToDashboard />
      <div>
        <h1 className="text-2xl font-semibold text-finance-text">Plexus Engagement</h1>
        <p className="text-sm text-finance-text-muted">Canonical ancillary cases and their Engagement list memberships.</p>
      </div>
      <CanonicalOverviewPanel section="engagement" />
    </div>
  );
}
