// Mission Control — read-only operations cockpit.
//
// At-a-glance overview that summarizes other surfaces rather than
// duplicating their workflows: today's patient + ancillary load by
// site (from /api/schedule/dashboard), outstanding invoice aging
// (from /api/invoices/aging), billing readiness (from
// /api/billing-records), and quick links into the canonical surfaces.
//
// No new endpoints or schema — every number is derived from data the
// rest of the app already loads.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import {
  Radar,
  Brain,
  Activity,
  Stethoscope,
  Users,
  Receipt,
  ClipboardList,
  Phone,
  Sparkles,
  ExternalLink,
  Layers,
} from "lucide-react";
import { useScheduleDashboard } from "@/hooks/api/dashboard";
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

function countAncillaryLike(breakdown: Record<string, number>, patterns: string[]) {
  return Object.entries(breakdown).reduce((sum, [name, count]) => {
    const normalized = name.toLowerCase();
    return patterns.some((pattern) => normalized.includes(pattern)) ? sum + count : sum;
  }, 0);
}

export default function MissionControlPage() {
  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError } = useScheduleDashboard({});

  const { data: aging, isLoading: agingLoading, isError: agingError } = useQuery<AgingResponse>({
    queryKey: qk.invoices.aging(),
  });

  const { data: billingRecords = [], isLoading: billingLoading, isError: billingError } = useQuery<BillingRecord[]>({
    queryKey: ["/api/billing-records"],
    queryFn: async () => {
      const res = await fetch("/api/billing-records", { credentials: "include" });
      if (!res.ok) throw new Error(`Billing fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const today = dashboard?.today ?? "";
  const clinicTabs = dashboard?.clinicTabs ?? [];

  // Per-site totals for today, plus app-wide ancillary breakdown.
  const siteSummaries = useMemo(() => {
    return clinicTabs.map((tab) => {
      const cell = tab.monthCells.find((c) => c.isoDate === today) || null;
      const patients = cell?.patients ?? [];
      const breakdown: Record<string, number> = {};
      for (const p of patients) {
        for (const a of p.ancillaries ?? []) breakdown[a] = (breakdown[a] || 0) + 1;
      }
      return {
        clinicKey: tab.clinicKey,
        clinicLabel: tab.clinicLabel,
        patientCount: cell?.patientCount ?? 0,
        ancillaryCount: Object.values(breakdown).reduce((s, c) => s + c, 0),
        brainWaveCount: countAncillaryLike(breakdown, ["brainwave", "brain wave", "brain"]),
        vitalWaveCount: countAncillaryLike(breakdown, ["vitalwave", "vital wave", "vital"]),
        ultrasoundCount: countAncillaryLike(breakdown, ["ultrasound", "ultra sound", "us"]),
      };
    });
  }, [clinicTabs, today]);

  const totals = useMemo(() => {
    return siteSummaries.reduce(
      (acc, s) => ({
        patients: acc.patients + s.patientCount,
        ancillaries: acc.ancillaries + s.ancillaryCount,
        brainWave: acc.brainWave + s.brainWaveCount,
        vitalWave: acc.vitalWave + s.vitalWaveCount,
        ultrasound: acc.ultrasound + s.ultrasoundCount,
      }),
      { patients: 0, ancillaries: 0, brainWave: 0, vitalWave: 0, ultrasound: 0 },
    );
  }, [siteSummaries]);

  const billingStats = useMemo(() => {
    return {
      total: billingRecords.length,
      readyToBill: billingRecords.filter((r) => {
        const doc = (r.documentationStatus ?? "").toLowerCase();
        const bill = (r.billingStatus ?? "").toLowerCase();
        return (doc === "complete" || doc === "ready") && (!bill || bill === "not billed" || bill === "not started");
      }).length,
    };
  }, [billingRecords]);

  const invoiceStats = {
    openCount: aging?.totals.invoiceCount ?? 0,
    totalBalance: aging?.totals.totalBalance ?? "0",
    current: aging?.totals.buckets["0-30"] ?? "0",
    aging31to60: aging?.totals.buckets["31-60"] ?? "0",
    aging60plus: aging?.totals.buckets["60+"] ?? "0",
  };

  const isLoading = dashboardLoading || agingLoading || billingLoading;
  const isError = dashboardError || agingError || billingError;

  const metricCards = [
    { label: "Patients Today", value: totals.patients, Icon: Users, tone: "text-slate-900", bg: "bg-slate-100 text-slate-700" },
    { label: "BrainWave", value: totals.brainWave, Icon: Brain, tone: "text-purple-700", bg: "bg-purple-100 text-purple-700" },
    { label: "VitalWave", value: totals.vitalWave, Icon: Activity, tone: "text-red-600", bg: "bg-red-100 text-red-600" },
    { label: "Ultrasound", value: totals.ultrasound, Icon: Stethoscope, tone: "text-emerald-700", bg: "bg-emerald-100 text-emerald-700" },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-30">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-indigo-700">
            <Radar className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
              PLEXUS ANCILLARY · MISSION CONTROL
            </div>
            <h1
              className="text-xl font-semibold tracking-tight text-slate-900"
              data-testid="text-mission-control-title"
            >
              Mission Control
            </h1>
            <p className="text-[11px] text-slate-500">
              Live operations overview across screening, ancillaries, and billing.
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto bg-slate-50/40">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-6xl mx-auto">
          {isLoading && (
            <div className="py-12 text-center text-slate-400 text-sm" data-testid="status-mission-control-loading">
              Loading operations data…
            </div>
          )}

          {!isLoading && isError && (
            <div
              className="py-12 text-center text-red-600 text-sm rounded-lg border border-red-200 bg-red-50"
              data-testid="status-mission-control-error"
            >
              Couldn't load some operations data. Please refresh to try again.
            </div>
          )}

          {!isLoading && !isError && (
            <>
              {/* Top-line metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="mission-control-metrics">
                {metricCards.map((m) => (
                  <Card key={m.label} className="p-4 flex items-center gap-3" data-testid={`metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${m.bg}`}>
                      <m.Icon className="w-5 h-5" />
                    </span>
                    <div>
                      <div className={`text-2xl font-bold tabular-nums ${m.tone}`}>{m.value}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{m.label}</div>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Today's load by site */}
                <Card className="p-4 space-y-3 lg:col-span-2" data-testid="mission-control-by-site">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700">
                        <Stethoscope className="w-4 h-4" />
                      </span>
                      <span className="font-semibold text-slate-800 text-sm">Today's Load by Site</span>
                    </div>
                    <Link href="/plexus-iq">
                      <a className="text-xs text-blue-600 hover:underline flex items-center gap-1" data-testid="link-plexus-iq">
                        Plexus IQ <ExternalLink className="w-3 h-3" />
                      </a>
                    </Link>
                  </div>

                  {siteSummaries.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-sm">No sites scheduled today.</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {siteSummaries.map((s) => (
                        <div key={s.clinicKey} className="flex items-center justify-between py-2.5" data-testid={`site-row-${s.clinicKey}`}>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-800 truncate">{s.clinicLabel}</div>
                            <div className="text-[11px] text-slate-500">{s.patientCount} patients · {s.ancillaryCount} ancillaries</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="rounded-md bg-purple-50 text-purple-700 text-[11px] font-semibold px-2 py-1 tabular-nums">BW {s.brainWaveCount}</span>
                            <span className="rounded-md bg-red-50 text-red-600 text-[11px] font-semibold px-2 py-1 tabular-nums">VW {s.vitalWaveCount}</span>
                            <span className="rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-1 tabular-nums">US {s.ultrasoundCount}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Invoice aging */}
                <Card className="p-4 space-y-3" data-testid="mission-control-invoices">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700">
                        <Receipt className="w-4 h-4" />
                      </span>
                      <span className="font-semibold text-slate-800 text-sm">Invoices</span>
                    </div>
                    <Link href="/invoices">
                      <a className="text-xs text-blue-600 hover:underline flex items-center gap-1" data-testid="link-invoices">
                        View all <ExternalLink className="w-3 h-3" />
                      </a>
                    </Link>
                  </div>

                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-500 uppercase tracking-wide">Total Outstanding</div>
                    <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{fmtMoney(invoiceStats.totalBalance)}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{invoiceStats.openCount} open invoices</div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-center" data-testid="bucket-current">
                      <div className="font-bold text-emerald-700 tabular-nums text-sm">{fmtMoney(invoiceStats.current)}</div>
                      <div className="text-[10px] text-emerald-600 mt-0.5">0–30 days</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-center" data-testid="bucket-31-60">
                      <div className="font-bold text-amber-700 tabular-nums text-sm">{fmtMoney(invoiceStats.aging31to60)}</div>
                      <div className="text-[10px] text-amber-600 mt-0.5">31–60 days</div>
                    </div>
                    <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-center" data-testid="bucket-60-plus">
                      <div className="font-bold text-red-700 tabular-nums text-sm">{fmtMoney(invoiceStats.aging60plus)}</div>
                      <div className="text-[10px] text-red-600 mt-0.5">60+ days</div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center justify-between" data-testid="stat-billing-ready">
                    <span className="text-[12px] text-slate-600">Billing records ready to bill</span>
                    <span className="text-lg font-bold text-amber-700 tabular-nums">{billingStats.readyToBill}</span>
                  </div>
                </Card>
              </div>

              {/* Quick links */}
              <Card className="p-4 space-y-3" data-testid="mission-control-quick-links">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Quick Links</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                  {[
                    { href: "/plexus-iq", label: "Plexus IQ", Icon: Sparkles, color: "text-violet-600" },
                    { href: "/engagement-center", label: "Engagement Center", Icon: Phone, color: "text-blue-600" },
                    { href: "/billing", label: "Billing", Icon: ClipboardList, color: "text-emerald-600" },
                    { href: "/invoices", label: "Invoices", Icon: Receipt, color: "text-amber-600" },
                    { href: "/patient-directory", label: "Patient Directory", Icon: Users, color: "text-indigo-600" },
                  ].map((q) => (
                    <Link key={q.href} href={q.href}>
                      <a
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm text-slate-700 font-medium"
                        data-testid={`quick-link-${q.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <q.Icon className={`w-4 h-4 shrink-0 ${q.color}`} />
                        <span className="truncate">{q.label}</span>
                      </a>
                    </Link>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
