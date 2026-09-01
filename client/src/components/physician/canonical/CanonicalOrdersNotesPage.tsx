// Phase 2H — canonical Orders & Notes page (flag-ON replacement for the
// mock-backed OrdersNotesPage body). Renders canonical bounded document rows
// from the Unified Ancillary Documents spine. NO mock orders/notes/documents,
// NO second signing workflow (the existing real sign/return endpoints are
// unchanged and unreferenced here). Preserves Back to Dashboard + the heading.

import { BackToDashboard } from "../ClinicianPortalShell";
import { CanonicalOverviewPanel } from "../CanonicalOverviewPanel";
import { SignaturesTab } from "../SignaturesTab";

export function CanonicalOrdersNotesPage() {
  return (
    <div className="space-y-6" data-testid="canonical-orders-page">
      <BackToDashboard />
      <div>
        <h1 className="text-2xl font-semibold text-finance-text">Orders & Notes</h1>
        <p className="text-sm text-finance-text-muted">Canonical Unified Ancillary Documents — order notes, procedure notes, and reports.</p>
      </div>
      {/* Actionable signing worklist — the EXISTING hardened physician-portal
          signature workflow (view + Slice-C-gated sign/return). This is a reuse,
          not a second workflow: it calls /api/physician-portal/signature-items
          and /:id/sign with the current version/fingerprint tokens. */}
      <section data-testid="canonical-orders-signature-queue" className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Action queue — review &amp; sign</h2>
        <SignaturesTab />
      </section>
      {/* Read-only canonical document status overview (reflects Signed after sign). */}
      <CanonicalOverviewPanel section="ordersNotes" />
    </div>
  );
}
