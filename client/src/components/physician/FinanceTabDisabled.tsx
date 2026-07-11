// Physician Portal — Finance tab (disabled shell).
//
// Deliberate design decision, not a placeholder for future work: the
// archive's Physician Portal Finance tab surfaced KPIs derived from a
// mix of live billing tables and derived-but-not-audited values that
// felt like real financial numbers. This project's rules explicitly
// forbid presenting fake data as live.
//
// Rather than fabricate KPIs, this tab renders an honest disabled state
// and points administrators to the canonical billing surfaces (Invoices
// / Billing Auditor / Billing Reports) that already exist on main and
// are backed by real transactional data.
//
// When we choose to build a repo-layered Finance service — with a
// proper audit trail across invoices, payments, denials, and remittance
// events — this file will be replaced with the real live view.

import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink } from "lucide-react";

export function FinanceTabDisabled() {
  return (
    <div
      className="space-y-4"
      data-testid="physician-finance-tab-disabled"
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700"
            aria-hidden
          />
          <div className="space-y-2 text-sm text-amber-900">
            <p className="font-semibold">Finance view is not enabled here.</p>
            <p>
              Physician-facing financial KPIs are not yet backed by an audited,
              repo-layered service. Rather than surface derived values that
              could be misread as live, this tab is intentionally disabled.
            </p>
            <p>
              The canonical billing surfaces below are the source of truth for
              live financial data:
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/billing">
          <Button
            variant="outline"
            className="w-full justify-between"
            data-testid="finance-link-billing"
          >
            Billing dashboard <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/billing-readiness">
          <Button
            variant="outline"
            className="w-full justify-between"
            data-testid="finance-link-readiness"
          >
            Billing readiness <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/invoices">
          <Button
            variant="outline"
            className="w-full justify-between"
            data-testid="finance-link-invoices"
          >
            Invoices <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/billing-auditor">
          <Button
            variant="outline"
            className="w-full justify-between"
            data-testid="finance-link-auditor"
          >
            Billing auditor <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/billing-reports">
          <Button
            variant="outline"
            className="w-full justify-between"
            data-testid="finance-link-reports"
          >
            Billing reports <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/remittance-audit">
          <Button
            variant="outline"
            className="w-full justify-between"
            data-testid="finance-link-remittance"
          >
            Remittance audit <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
