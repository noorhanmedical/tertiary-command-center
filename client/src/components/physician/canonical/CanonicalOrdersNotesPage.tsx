// Phase 2H — canonical Orders & Notes page (flag-ON replacement for the
// mock-backed OrdersNotesPage body). Renders canonical bounded document rows
// from the Unified Ancillary Documents spine. NO mock orders/notes/documents,
// NO second signing workflow (the existing real sign/return endpoints are
// unchanged and unreferenced here). Preserves Back to Dashboard + the heading.

import { BackToDashboard } from "../ClinicianPortalShell";
import { CanonicalOverviewPanel } from "../CanonicalOverviewPanel";

export function CanonicalOrdersNotesPage() {
  return (
    <div className="space-y-6" data-testid="canonical-orders-page">
      <BackToDashboard />
      <div>
        <h1 className="text-2xl font-semibold text-finance-text">Orders & Notes</h1>
        <p className="text-sm text-finance-text-muted">Canonical Unified Ancillary Documents — order notes, procedure notes, and reports.</p>
      </div>
      <CanonicalOverviewPanel section="ordersNotes" />
    </div>
  );
}
