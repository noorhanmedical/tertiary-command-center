// Billing reports — Phase 4 PR 4.8.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { fetchEod, fetchWeekly, fetchMonthly } from "@/lib/billingReportsApi";

export default function BillingReportsPage() {
  const [facility, setFacility] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const { data: eod, isLoading: eodLoading } = useQuery({
    queryKey: ["eod", today, facility],
    queryFn: () => fetchEod(today, facility.trim() || undefined),
  });
  const { data: weekly, isLoading: weeklyLoading } = useQuery({
    queryKey: ["weekly", today, facility],
    queryFn: () => fetchWeekly(today, facility.trim() || undefined),
  });
  const { data: monthly, isLoading: monthlyLoading } = useQuery({
    queryKey: ["monthly", month, facility],
    queryFn: () => fetchMonthly(month, facility.trim() || undefined),
  });

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-6" data-testid="billing-reports-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Billing reports</h1>
          <p className="text-xs text-slate-500">
            EOD / weekly / monthly rollups derived from canonical
            tables. Source missing → label says "—".
          </p>
        </div>
        <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="facility id (optional)" className="h-8 w-[180px] text-xs" data-testid="reports-facility-input" />
      </header>

      <Card className="p-4 bg-white" data-testid="report-eod">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">EOD — {eod?.date ?? today}</h2>
        {eodLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : eod ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Ready to invoice" value={eod.readyToInvoice} />
            <Stat label="Blocked" value={eod.blocked} />
            <Stat label="Drafts" value={eod.invoicesDrafted} />
            <Stat label="Approved" value={eod.invoicesApproved} />
            <Stat label="Sent" value={eod.invoicesSent} />
            <Stat label="Payments posted" value={`${eod.paymentsPosted?.count ?? 0} ($${(eod.paymentsPosted?.total ?? 0).toFixed(2)})`} />
            <Stat label="Denials opened" value={eod.denialsOpened} />
            <Stat label="Overdue invoices" value={eod.overdueInvoices} />
            <Stat label="Delivery failures" value={eod.deliveryFailures} />
          </div>
        ) : null}
      </Card>

      <Card className="p-4 bg-white" data-testid="report-weekly">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Weekly — {weekly?.weekStart ?? today} → {weekly?.weekEnd ?? "+7d"}</h2>
        {weeklyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : weekly ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Invoices generated" value={weekly.invoicesGenerated} />
            <Stat label="Invoices sent" value={weekly.invoicesSent} />
            <Stat label="Total billed" value={`$${(weekly.totalBilled ?? 0).toFixed(2)}`} />
            <Stat label="Payments received" value={`$${(weekly.paymentsReceived ?? 0).toFixed(2)}`} />
            <Stat label="Outstanding balance" value={`$${(weekly.outstandingBalance ?? 0).toFixed(2)}`} />
            <Stat label="Denials" value={weekly.denials} />
            <Stat label="Blocked aging (days)" value={weekly.blockedAgingDays} />
          </div>
        ) : null}
      </Card>

      <Card className="p-4 bg-white" data-testid="report-monthly">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Monthly — {monthly?.month ?? month}</h2>
        {monthlyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : monthly ? (
          <>
            <Stat label="Unpaid invoices" value={monthly.unpaidInvoiceCount} />
            <Stat label="Batches generated" value={monthly.scheduleCompliance?.batchesGenerated ?? 0} />
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Per facility</div>
              <ul className="text-[11px] space-y-1">
                {Object.entries(monthly.facilityTotals ?? {}).map(([f, t]: [string, any]) => (
                  <li key={f} data-testid={`monthly-facility-${f}`}>{f}: {t.invoices} invoices · $${t.totalBilled?.toFixed?.(2) ?? "0"} billed · $${t.outstanding?.toFixed?.(2) ?? "0"} outstanding</li>
                ))}
              </ul>
            </div>
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Denial summary</div>
              <ul className="text-[11px] space-y-1">
                {Object.entries(monthly.denialSummary ?? {}).map(([k, v]) => (
                  <li key={k} data-testid={`monthly-denial-${k}`}>{k}: {v as number}</li>
                ))}
                {Object.keys(monthly.denialSummary ?? {}).length === 0 ? <li className="italic text-slate-500">none</li> : null}
              </ul>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-100 bg-slate-50/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-medium text-slate-900" data-testid={`report-stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value ?? "—"}</div>
    </div>
  );
}
