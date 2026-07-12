import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Receipt,
  DollarSign,
  FileText,
  ExternalLink,
  ClipboardList,
  Layers,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import type { AgingResponse } from "@/hooks/api/invoices";
import { qk } from "@/hooks/api/keys";

type BillingRecord = {
  id: number;
  billingStatus: string | null;
  documentationStatus: string | null;
};

function fmtMoney(v: string | null | undefined): string {
  if (v == null || v === "") return "$0.00";
  const n = parseFloat(v);
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function EngagementPanel({ onClose }: { onClose: () => void }) {
  const { data: aging, isLoading: agingLoading } = useQuery<AgingResponse>({
    queryKey: qk.invoices.aging(),
  });

  const { data: billingRecords = [], isLoading: billingLoading } = useQuery<BillingRecord[]>({
    queryKey: ["/api/billing-records"],
    queryFn: async () => {
      const res = await fetch("/api/billing-records", { credentials: "include" });
      if (!res.ok) throw new Error(`Billing fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const billingStats = {
    total: billingRecords.length,
    billed: billingRecords.filter((r) => {
      const s = (r.billingStatus ?? "").toLowerCase();
      return s === "submitted" || s === "accepted" || s === "paid" || s === "paid in full";
    }).length,
    unbilled: billingRecords.filter((r) => {
      const s = (r.billingStatus ?? "").toLowerCase();
      return !s || s === "not billed" || s === "not started";
    }).length,
    readyToBill: billingRecords.filter((r) => {
      const doc = (r.documentationStatus ?? "").toLowerCase();
      const bill = (r.billingStatus ?? "").toLowerCase();
      return (doc === "complete" || doc === "ready") && (!bill || bill === "not billed" || bill === "not started");
    }).length,
  };

  const invoiceStats = {
    openCount: aging?.totals.invoiceCount ?? 0,
    totalBalance: aging?.totals.totalBalance ?? "0",
    current: aging?.totals.buckets["0-30"] ?? "0",
    aging31to60: aging?.totals.buckets["31-60"] ?? "0",
    aging60plus: aging?.totals.buckets["60+"] ?? "0",
  };

  const isLoading = agingLoading || billingLoading;

  return (
    <div className="space-y-5" data-testid="engagement-panel">
      {isLoading && (
        <div className="py-8 text-center text-slate-400 text-sm">Loading engagement data…</div>
      )}

      {!isLoading && (
        <>
          <Card className="p-4 space-y-3" data-testid="engagement-billing-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-700">
                  <ClipboardList className="w-4 h-4" />
                </span>
                <span className="font-semibold text-slate-800 text-sm">Billing</span>
              </div>
              <Link href="/billing" onClick={onClose}>
                <a className="text-xs text-blue-600 hover:underline flex items-center gap-1" data-testid="link-billing-full">
                  View all <ExternalLink className="w-3 h-3" />
                </a>
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center" data-testid="stat-billing-total">
                <div className="text-2xl font-bold text-slate-900 tabular-nums">{billingStats.total}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Total Records</div>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center" data-testid="stat-billing-billed">
                <div className="text-2xl font-bold text-emerald-700 tabular-nums">{billingStats.billed}</div>
                <div className="text-[11px] text-emerald-600 mt-0.5">Billed</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center" data-testid="stat-billing-unbilled">
                <div className="text-2xl font-bold text-slate-600 tabular-nums">{billingStats.unbilled}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Unbilled</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-center" data-testid="stat-billing-ready">
                <div className="text-2xl font-bold text-amber-700 tabular-nums">{billingStats.readyToBill}</div>
                <div className="text-[11px] text-amber-600 mt-0.5">Ready to Bill</div>
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-3" data-testid="engagement-invoice-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700">
                  <Receipt className="w-4 h-4" />
                </span>
                <span className="font-semibold text-slate-800 text-sm">Invoices</span>
              </div>
              <Link href="/invoices" onClick={onClose}>
                <a className="text-xs text-blue-600 hover:underline flex items-center gap-1" data-testid="link-invoices-full">
                  View all <ExternalLink className="w-3 h-3" />
                </a>
              </Link>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center justify-between" data-testid="stat-invoices-outstanding">
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">Total Outstanding</div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                  {fmtMoney(invoiceStats.totalBalance)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-500">Open Invoices</div>
                <div className="text-xl font-bold text-slate-700 tabular-nums">{invoiceStats.openCount}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-center" data-testid="stat-invoices-current">
                <div className="font-bold text-emerald-700 tabular-nums text-sm">{fmtMoney(invoiceStats.current)}</div>
                <div className="text-[10px] text-emerald-600 mt-0.5">0–30 days</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-center" data-testid="stat-invoices-aging-31">
                <div className="font-bold text-amber-700 tabular-nums text-sm">{fmtMoney(invoiceStats.aging31to60)}</div>
                <div className="text-[10px] text-amber-600 mt-0.5">31–60 days</div>
              </div>
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-center" data-testid="stat-invoices-aging-60">
                <div className="font-bold text-red-700 tabular-nums text-sm">{fmtMoney(invoiceStats.aging60plus)}</div>
                <div className="text-[10px] text-red-600 mt-0.5">60+ days</div>
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-2" data-testid="engagement-quick-actions">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">Quick Actions</div>
            <Link href="/invoices" onClick={onClose}>
              <a
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium"
                data-testid="quick-action-invoices"
              >
                <Receipt className="w-4 h-4 text-emerald-600 shrink-0" />
                Invoices
              </a>
            </Link>
            <Link href="/billing-readiness" onClick={onClose}>
              <a
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium"
                data-testid="quick-action-billing-readiness"
              >
                <ClipboardList className="w-4 h-4 text-blue-600 shrink-0" />
                Billing Readiness
              </a>
            </Link>
            <Link href="/invoice-batches" onClick={onClose}>
              <a
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium"
                data-testid="quick-action-invoice-batches"
              >
                <Layers className="w-4 h-4 text-violet-600 shrink-0" />
                Invoice Batches
              </a>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
