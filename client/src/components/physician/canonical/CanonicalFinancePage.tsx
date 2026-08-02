// Phase 2H — canonical Finance page (flag-ON replacement for the mock-backed
// FinancePage body). Operational billing readiness ONLY: canonical counts,
// blockers, timestamps, and bounded case rows. NO revenue, claims, invoices,
// payments, payer amounts, or clinic/Plexus splits, and NO mock rows. Preserves
// Back to Dashboard, the Finance heading, and the existing finance-access gate.

import { usePortal, hasFinanceAccess } from "../portalContext";
import { BackToDashboard } from "../ClinicianPortalShell";
import { RestrictedAccessCard } from "../ui/primitives";
import { CanonicalOverviewPanel } from "../CanonicalOverviewPanel";

export function CanonicalFinancePage() {
  const { role } = usePortal();

  if (!hasFinanceAccess(role)) {
    return (
      <div className="space-y-6">
        <BackToDashboard />
        <RestrictedAccessCard />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="canonical-finance-page">
      <div className="flex items-center justify-between">
        <BackToDashboard />
        <span className="text-xs text-finance-text-muted">Role: {role} · Operational billing readiness</span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-finance-text">Finance</h1>
        <p className="text-sm text-finance-text-muted">Canonical operational billing readiness — no revenue, claims, invoices, or payments.</p>
      </div>
      <CanonicalOverviewPanel section="finance" />
    </div>
  );
}
